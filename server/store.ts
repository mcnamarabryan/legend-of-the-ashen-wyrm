import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FeedEntry, HallEntry, Resident, SaveFile } from './engine/types';

/**
 * PERSISTENCE — SQLite via sql.js.
 *
 * WHY NOT `node:sqlite`: Node 22 ships it, and in this WebContainer it imports
 * successfully and constructs an object with NO METHODS. It is a stub. Code
 * written against it would pass review, pass tests, and silently discard every
 * write. `sql.js` is the only SQLite that actually runs here — it is SQLite
 * compiled to WASM, so no native bindings and no node-gyp.
 *
 * WHY NOT `better-sqlite3`: needs native compilation. Impossible in a WASM
 * container.
 *
 * THE SHAPE OF THE DATA is deliberately boring. The engine already speaks
 * `SaveFile`: plain JSON, no class instances, no cycles. So a character is one
 * row with a JSON blob. We are not modelling armour in normal form; we are
 * making sure a character survives a restart. Anything more is a schema we
 * would have to migrate every time the engine gains a field, and the engine is
 * the source of truth for that shape, not the database.
 *
 * DURABILITY: sql.js keeps the whole database in memory and `export()` returns
 * the bytes. We write those bytes to disk after every mutation. At this scale —
 * a handful of characters, tens of KB — rewriting the file is cheaper than
 * reasoning about incremental pages, and it makes "what is on disk" trivially
 * equal to "what is in memory".
 *
 * ATOMICITY: we write to a temp file and rename. A crash mid-write leaves the
 * previous good file intact rather than a truncated one.
 */

const DB_FILE = process.env.WYRM_DB ?? 'data/realm.sqlite';

export interface StoredCharacter {
  name: string;
  /** Session token that created it. The only credential that may load it. */
  owner: string;
  save: SaveFile;
}

export interface RealmSnapshot {
  characters: StoredCharacter[];
  residents: Resident[];
  hall: HallEntry[];
  feed: FeedEntry[];
  /** UTC day the residents last progressed. */
  day: string;
}

export class RealmDb {
  private db: Database;
  private file: string;
  private dirty = false;

  private constructor(db: Database, file: string) {
    this.db = db;
    this.file = file;
  }

  /**
   * Open (or create) the database. Async because sql.js has to fetch and
   * instantiate its WASM module before anything else can happen.
   */
  static async open(file: string = DB_FILE): Promise<RealmDb> {
    const SQL: SqlJsStatic = await initSqlJs();

    let db: Database;
    if (existsSync(file)) {
      try {
        db = new SQL.Database(new Uint8Array(readFileSync(file)));
      } catch {
        /* A corrupt file must not brick the server. Start clean and say so. */
        console.error(`[realm] could not read ${file}; starting a new realm`);
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }

    const store = new RealmDb(db, file);
    store.migrate();
    return store;
  }

  /** Schema. `user_version` is the migration handle. */
  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS character (
        name       TEXT PRIMARY KEY,
        owner      TEXT NOT NULL,
        save       TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS realm (
        id         INTEGER PRIMARY KEY CHECK (id = 1),
        residents  TEXT NOT NULL,
        hall       TEXT NOT NULL,
        feed       TEXT NOT NULL,
        day        TEXT NOT NULL
      );
    `);
    this.dirty = true;
    this.flush();
  }

  /* ---------------------------------------------------------------- */
  /* Reads                                                            */
  /* ---------------------------------------------------------------- */

  /** Every character, owner included. Used to rebuild the session map. */
  characters(): StoredCharacter[] {
    const rows = this.db.exec('SELECT name, owner, save FROM character');
    if (rows.length === 0) return [];

    return rows[0].values.map((row) => {
      const name = String(row[0]);
      const owner = String(row[1]);
      const save = JSON.parse(String(row[2])) as SaveFile;
      return { name, owner, save };
    });
  }

  /** The realm-scoped bit: residents, hall, feed, day. */
  snapshot(fallbackResidents: Resident[]): RealmSnapshot {
    const rows = this.db.exec('SELECT residents, hall, feed, day FROM realm WHERE id = 1');

    if (rows.length === 0 || rows[0].values.length === 0) {
      /* First boot: seed what the content layer says the realm looks like. */
      return {
        characters: [],
        residents: fallbackResidents,
        hall: [],
        feed: [],
        day: '',
      };
    }

    const [residents, hall, feed, day] = rows[0].values[0];
    return {
      characters: this.characters(),
      residents: JSON.parse(String(residents)) as Resident[],
      hall: JSON.parse(String(hall)) as HallEntry[],
      feed: JSON.parse(String(feed)) as FeedEntry[],
      day: String(day),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Writes                                                           */
  /* ---------------------------------------------------------------- */

  putCharacter(name: string, owner: string, save: SaveFile): void {
    this.db.run(
      `INSERT INTO character (name, owner, save, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         owner = excluded.owner,
         save = excluded.save,
         updated_at = excluded.updated_at`,
      [name.trim().toLowerCase(), owner, JSON.stringify(save), Date.now()],
    );
    this.flush();
  }

  putRealm(input: {
    residents: Resident[];
    hall: HallEntry[];
    feed: FeedEntry[];
    day: string;
  }): void {
    this.db.run(
      `INSERT INTO realm (id, residents, hall, feed, day)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         residents = excluded.residents,
         hall = excluded.hall,
         feed = excluded.feed,
         day = excluded.day`,
      [
        JSON.stringify(input.residents),
        JSON.stringify(input.hall),
        JSON.stringify(input.feed),
        input.day,
      ],
    );
    this.flush();
  }

  /** One character, renamed. Ownership follows the character. */
  deleteCharacter(name: string): void {
    this.db.run('DELETE FROM character WHERE name = ?', [name.trim().toLowerCase()]);
    this.flush();
  }

  /* ---------------------------------------------------------------- */
  /* Durability                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Write the in-memory database to disk.
   *
   * Temp file plus rename, so an interrupted write leaves the previous good
   * file rather than a half-written one. `dirty` avoids pointless rewrites when
   * nothing changed.
   */
  flush(): void {
    if (!this.dirty) this.dirty = false;
    const bytes = this.db.export();
    const tmp = `${this.file}.tmp`;

    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(tmp, Buffer.from(bytes));
      renameSync(tmp, this.file);
      this.dirty = false;
    } catch (err) {
      /* Never let a disk problem crash a game. Log it; the realm lives on in
         memory and the next flush may succeed. */
      console.error(`[realm] could not write ${this.file}:`, err);
    }
  }

  close(): void {
    this.flush();
    this.db.close();
  }
}
