import type { HeaderCharacter } from '../api/wire';

/**
 * Rows 1–2 of the grid: realm, node, and the character's vitals.
 *
 * Every value here arrived from the server. The header cannot derive anything
 * — it has no stats and no rules — which is exactly the point.
 */

export interface HeaderProps {
  character: HeaderCharacter | null;
  connection: string;
}

function bar(value: number, max: number, width = 10): string {
  if (max <= 0) return '\u00b7'.repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return '\u2588'.repeat(filled) + '\u00b7'.repeat(width - filled);
}

const REALM = 'BKM REALM NODE 01';

export function Header({ character, connection }: HeaderProps) {
  if (!character) {
    return (
      <header className="term-header">
        <div className="header-row">
          <span className="t-bright">{REALM}</span>
          <span className="t-dim">
            {connection === 'online' ? 'NO CARRIER' : connection.toUpperCase()}
          </span>
          <span className="t-dim">2400 BAUD</span>
        </div>
        <div className="header-row header-rule">
          <span className="t-dim">{'\u2500'.repeat(78)}</span>
        </div>
      </header>
    );
  }

  const c = character;
  const hpRatio = c.maxHp > 0 ? c.hp / c.maxHp : 0;

  return (
    <header className="term-header">
      <div className="header-row">
        <span className="t-bright">{REALM}</span>
        <span className="t-dim">NODE 01</span>
        <span className="t-base">{c.name}</span>
        <span className="t-dim">Lvl {c.levelRoman}</span>
        <span className="t-gold">{c.title}</span>
      </div>

      <div className="header-row">
        <span className="t-dim">
          HP{' '}
          <span className={hpRatio < 0.34 ? 't-red' : 't-base'}>
            {String(c.hp).padStart(3)}/{c.maxHp}
          </span>
        </span>
        <span className="t-dim" aria-hidden="true">
          {bar(c.hp, c.maxHp)}
        </span>
        <span className={c.turnsRemaining > 0 ? 't-base' : 't-red'}>
          T {c.turnsRemaining}
        </span>
        <span className="t-gold">{c.gold}g</span>
        {c.gems > 0 && <span className="t-gold">{c.gems}\u25c7</span>}
        <span className="t-dim">
          W{c.weaponPower} A{c.armorPower}
        </span>
        {c.retired && <span className="t-gold">RETIRED</span>}
      </div>

      <div className="header-rule t-dim" aria-hidden="true">
        {'\u2500'.repeat(78)}
      </div>
    </header>
  );
}
