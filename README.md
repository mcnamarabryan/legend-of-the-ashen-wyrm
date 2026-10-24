# Legend of the Ashen Wyrm

A browser-hosted text RPG rendered as a green-phosphor CRT terminal. Ten turns a
day, a forest full of monsters, a town full of prices, and one dragon at the end
of it.

Mechanically inspired by the BBS door-game genre. Original name, original text,
original content — see §Legal.

---

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine + headless playthrough
npm run build
```

Keyboard only. Any keypress skips the typewriter; the next keypress acts.

```
[F] Forest    [I] Inn       [B] Bank      [S] Shop
[H] Healer    [C] Character [W] Who's Who [P] Attack
[D] Wyrm      [Q] Quit      [?] Help      [ESC] Back
```

---

## What this is

A single realm on a single node, `BKM REALM NODE 01`. You get ten turns a day.
Fights cost a turn; shopping, banking, healing, and talking to Wren are free.
Turns reset once per UTC day. Reach level XII and the mountain opens.

The endgame is a 400 HP wyrm that strikes twice every third round. Wren tells you
that, in character, at stage three of the inn subplot — it is a real mechanical
hint wearing a conversation.

---

## Architecture

The engine is pure functions over plain data. It has no React import, no DOM
access, and never calls `Math.random()` — the RNG is always injected. That is why
`tests/playthrough.spec.ts` can play twenty days of the game headlessly and assert
that a character reaches level XII and kills the wyrm.

```
src/
  engine/     pure TS: rules, combat, progression, economy, encounters,
              pvp, dragon, save, creation, rng, types
  content/    data only: monsters, items, spells, bots, strings
  state/      flow.ts (pure action → Step), useGame.ts (the only side effects),
              RealmStore.ts (localStorage + BroadcastChannel)
  ui/         Crt, Header, TerminalLog, Markup, screens/
  styles/     crt.css — custom properties, no framework
```

Three seams matter:

1. **`rules.ts`** — every tunable number in the design lives in one exported
   object. Balance changes are one-file changes.
2. **`RealmStore`** — an interface with a local implementation. Swapping in a
   server later does not touch game logic.
3. **`flow.ts`** — every player action is a pure function returning the new
   lines, character, view, and prompt. The React hook just applies the result and
   persists it.

### Design decisions worth naming

- **The terminal is DOM text, not a canvas.** Every line is a `<span>` in a
  `<pre>`-like grid. Text is selectable, screen-readable, and searchable. A canvas
  would have been easier and would have excluded people.
- **The save is migrated, never discarded.** `loadSave` fills missing fields and
  returns a valid `SaveFile`; a corrupt save returns `null` and the game starts
  fresh rather than throwing.
- **The day rollover is idempotent.** Calling it twenty times in one day grants
  ten turns once. This is the single most likely thing to get wrong in a
  daily-turns game, so it is the most heavily tested.

---

## Trust model — read this

**The client clock is authoritative. The game is not tamper-proof.**

Turn resets compare a stored UTC date against `Date.now()`. Anyone with devtools
can set their system clock forward and take another ten turns. Saves live in
`localStorage` and can be edited. There is no server, so there is no source of
truth other than the browser.

This is a deliberate trade — a game that requires an account and a backend to
give you ten turns a day is a worse artifact than one that does not. The fix, when
it matters, is server-side turn reset and PvP resolution: the engine is already
pure functions over plain data, so it runs on Node unchanged.

---

## Persistence and "multiplayer"

Three layers, and it matters which one is which.

### 1. Several characters per browser (real, persisted)

Saves are stored as a **map of slots**, keyed by lowercased character name, under
`ashen-wyrm.saves.v2`. Each tab records which slot it is playing in
**`sessionStorage`**, which is per-tab by definition.

That combination is the whole trick:

- Two tabs can hold two different characters without overwriting each other,
  because they write to different slots in the map.
- A newly opened tab starts with no slot selected, so it offers the full roster
  and can create a new character instead of silently hijacking the first tab.

The title screen is also the character picker. It lists every slot, marks the one
this tab is currently playing, and `[1-9]` loads any of them.

The old single-key save (`ashen-wyrm.save.v1`) is migrated into a slot on first
load, then deleted. Migrated, never dropped.

### 2. Same-browser multiplayer (real, not simulated)

Characters in the same browser share a realm (`ashen-wyrm.realm.v1`) and a
`BroadcastChannel`. Create a character in one tab and another in a second tab, and:

- they see each other in Who's Who,
- they can attack and steal from each other,
- the realm feed updates live in both tabs.

That is genuine multiplayer within one browser profile. It is not networked
across machines, and it cannot be without a server.

### 3. The residents (simulated, and labelled as such)

Six adventurers — Grimwold, Sable, Orin, Halvard, Juniper, Coel — live in the
realm from the start. They progress between sessions, they appear in Who's Who
and in the PvP target list, and they can attack you while you are away.

They are not people. **Every list that contains them tags them `[sim]`**, and the
player's own row is tagged `[you]`. The tag comes from one function (`roster()` in
`state/flow.ts`), which both Who's Who and the PvP picker read, so a resident
cannot be a ghost in one list and a person in another. The realm feed says so
plainly too.

### What a server would change

`SaveStore` and `RealmStore` are interfaces with local implementations. Phase 2
swaps in remote ones that hit `/api/save` and `/api/realm`; turn reset and PvP
resolution move server-side; the trust model becomes honest. **The engine package
does not change** — it is pure functions over plain data and already runs on Node.

---

## Accessibility

- Real DOM text throughout; the narrative region is `role="log"` with
  `aria-live="polite"`.
- `prefers-reduced-motion: reduce` disables flicker, grain, curvature, the
  power-on animation, and the typewriter. The settings panel cannot turn them
  back on.
- The game is keyboard-only by default. The settings panel is the one place with
  focusable buttons, because accessibility beats aesthetic purity.
- Phosphor on screen-black is roughly 11:1. The six CRT effect layers are tuned so
  body text never drops below 7:1. A contrast-boost toggle is available.
- Amber theme included. Amber-terminal people are a real constituency.

---

## Pacing

Level XII needs 19,000 XP. Reaching that takes roughly 200 forest victories, and a
1-in-8 encounter rate caps a day at about 8.75 fights — so **~23 days** of
unfailing play is the arithmetic floor, not the 19–22 the design document
optimistically claimed. The headless harness asserts the journey completes within
a generous budget rather than asserting a figure the maths does not support. If
you want the shorter pace to be true, the honest levers are `turnsPerDay` or the
XP table — never both.

There is one deliberate addition to the spec: a 6% gem drop on won fights
(`gameRules.forest.gemDropChance`). Gems gate Dragon Scale armor, and that armor
is what makes the 400 HP / 45 attack wyrm survivable. Without a steady trickle
the endgame is mathematically unreachable, which is a bug rather than a challenge.

---

## Legal

*Legend of the Red Dragon* and its characters are Seth Able Robinson's work,
distributed historically as shareware. This build copies no art, no text strings,
no distinctive monster names, and no assets from it. The title is original, the
inn subplot character is Wren (not Violet), the boss is the Ashen Wyrm, and the
player title is Wyrmbane.

Genre mechanics — daily turns, forest grinding, a dragon at the end — are not
protectable. Expression is. This is an original game in a shared tradition.

---

## The three things most likely to get botched

1. Scattering tunable numbers instead of using `rules.ts`.
2. Building the terminal as a canvas, torching accessibility.
3. Skipping the rollover idempotency check, handing out infinite turns.

Guarded. See `tests/engine.spec.ts`.
