# LEGEND OF THE ASHEN WYRM — Build Plan & Agent Spec

> A modern, browser-hosted, multiplayer rebuild of the BBS door-game genre — rendered as a
> green-phosphor CRT terminal. Mechanically inspired by *Legend of the Red Dragon*; original
> name, original text, original content.

**Status:** specification locked. Build not started.
**Document owner:** implementation agent (bolt.diy / WebContainer)
**Last revision:** v1.0

---

## 0. How to use this document

Read sections 1–2 first (environment constraints, historical grounding). Sections 3–5 are the
**authoritative specification** — implement them literally where numbers are given.

Do **not** invent mechanics that contradict §3. If a number is missing, extrapolate from the
nearest table rather than inventing a new subsystem. Every tunable number lives in
`src/engine/rules.ts` and nowhere else.

Section 12 lists the three things most likely to be botched. Read it before writing code.

---

## 1. Environment constraints (WebContainer)

| Constraint | Implication |
|---|---|
| Runs in-browser, Node-in-WASM | No native binaries, no `node-gyp`, no SQLite native bindings, no Python |
| Network egress restricted at runtime | No external API calls. No CDN fonts or scripts. Everything bundled or self-hosted |
| No durable server outside the browser | A dev server lives only while the tab is open. No persistent backend |
| Filesystem is project-scoped, resettable | Never store game saves on the container FS. Use `localStorage` / `IndexedDB` |
| npm registry reachable at build time | Pure-JS dependencies only. Game logic: zero dependencies |

**Consequence:** this is a fully client-side game. Everything is designed behind `SaveStore` and
`RealmStore` interfaces so a server can be swapped in later without touching game logic.

---

## 2. Source material: what the genre actually was

### 2.1 High confidence

- *Legend of the Red Dragon* is a **BBS door game** by **Seth Able Robinson** (Robinson
  Technologies), first released around **1989**; the version most people remember is the **4.x
  line**, mid-1990s.
- **Distribution:** shareware. Free to run; a registration fee unlocked level cap and extra content.
- **Door architecture:** the BBS launched `LORD.EXE` as a child process, passing a **drop file**
  (`DOOR.SYS` / `DORINFO1.DEF`) with the caller's handle, security level, time remaining on the
  node, and comms settings. The game drew ANSI to the serial line, then exited back to the BBS.
- **Aesthetic:** 80×25 text mode, ANSI color, ASCII/ANSI art title screens, keyboard-only input.
- **Structure:** menu hub with discrete locations (Inn, Forest, Bank, shops, Healer) plus a
  persistent character sheet.
- **Core loop:** limited **daily turns** → fight random forest monsters → **gold + experience** →
  buy **weapons/armor** → **level up** → become strong enough for **the dragon**.
- **Persistence:** fixed-length binary record files, random access by player slot/handle. Turns
  reset on a calendar-day basis.
- **Social layer:** PvP combat, a ranking list of the realm's strongest, a hall of fame for
  dragon-killers.
- **Characters:** an inn barmaid served as a long-running romance subplot; recurring forest NPC
  encounters (stranger, gypsy, wounded traveler) granted blessings, items, or cost gold.

### 2.2 Medium confidence — flavor anchors only, never asserted as fact

Character classes were three (Warrior / Magician / Thief). Primary combat stats were Strength and
Defense, with Agility affecting turn order or evasion and Charm driving social content. Currencies
were gold (common) and gems (rare). The dragon required a level threshold (commonly cited: 12).
Death was not permadeath.

### 2.3 Genuinely uncertain — do not claim as fact anywhere in the UI or docs

Exact default turns-per-day, exact stat names and starting values, exact version numbers and
release dates beyond §2.1, whether spells used a mana pool, exact monster and item names, whether
PvP was gated by level range, the precise dragon-fight mechanics.

**Instruction:** §2.2 and §2.3 are *flavor*; **§3 is spec and supersedes both.** Where §3 gives a
number, that number is correct *for this build*.

---

## 3. Game design specification

### 3.1 The loop

```
BOOT → title screen → [new character | continue] → Main Hub
Main Hub (consume turns) → Forest fights → gold + XP → Level up
       ↓                                          ↓
  Shop / Bank / Healer / Inn / PvP ←──────────────┘
       ↓
  Reach level 12 → The Ashen Wyrm → Hall of Fame → endgame
```

**One-line pitch:** ten turns a day, a forest full of monsters, a town full of prices, and one
dragon at the end of it.

### 3.2 Turns and the day rollover

- **10 turns per day** per character. Configurable via `gameRules.turnsPerDay`.
- **Consume a turn:** forest fight, PvP attack, wyrm attempt, thief steal.
- **Free actions:** shopping, banking, healing, character sheet, hall of fame, inn conversation,
  most special encounters.
- **Day rollover:** compare stored `lastTurnResetDay` (UTC `YYYY-MM-DD`) against now. If different
  → `turnsRemaining = turnsPerDay`, set new `lastTurnResetDay`. **Never grant retroactive turns for
  skipped days.** Idempotent: calling rollover twice in one day changes nothing.
- Store in UTC to dodge DST; display local time in the rollover message.
- **Trust model:** client clock is authoritative in Phase 1. Documented in the README as a known,
  deliberate limitation — it is not tamper-proof.

### 3.3 Character creation

Player supplies **name** (3–16 chars, `[A-Za-z' -]`, unique within realm), **sex** (flavor only,
gates some NPC dialogue), and **class**.

| Class | STR | DEF | AGI | CHM | HP | Identity |
|---|---|---|---|---|---|---|
| **Warrior** | 12 | 8 | 5 | 5 | 26 | Highest HP and damage. No spells. |
| **Magician** | 5 | 5 | 6 | 9 | 18 | Fragile; wins with spells and charm. |
| **Thief** | 8 | 6 | 11 | 7 | 21 | Evasive; can steal in town and in PvP. |

Starting kit: **Rusty Dagger** (3 dmg), **Rags** (1 arm), 50 gold, 0 gems, level 1, 0 XP.

### 3.4 Stats and derived values

- `maxHp = 15 + 11 × (level − 1)` → 15 at L1, 136 at L12.
- Damage roll: `max(1, atk − def + randInt(−2, +2))`
- `atk = STR + weaponDamage`; `def = DEF + armorValue`
- **Hit chance:** base 80%, ±2% per point of AGI difference, clamped 55–95%.
- **Critical:** 5% chance, ×2 damage, message `{bright}A critical blow!{/}`
- **Dodge (Thief):** +8% evasion.
- **Mana (Magician):** `maxMana = 8 + 4 × (level − 1)`. Full regen on day rollover, 25% on level up.
- **Charm** is social only. Check: `d20 + floor(CHM/2) ≥ difficulty`.

### 3.5 Level progression

| Level | Total XP | Title |
|---|---|---|
| 1 | 0 | Wanderer |
| 2 | 100 | Wanderer |
| 3 | 300 | Sellsword |
| 4 | 700 | Sellsword |
| 5 | 1,400 | Man-at-Arms |
| 6 | 2,500 | Man-at-Arms |
| 7 | 4,000 | Knight |
| 8 | 6,000 | Knight |
| 9 | 8,500 | Banneret |
| 10 | 11,500 | Banneret |
| 11 | 15,000 | Champion |
| 12 | 19,000 | Champion → **Wyrmbane** after the kill |

- On level up: recompute `maxHp`, heal to full, grant **+2 stat points** auto-allocated by class —
  Warrior `+1 STR +1 DEF`; Magician `+1 CHM +1 STR`; Thief `+1 AGI +1 STR`.
- XP is never lost except on death (§3.10).
- **Roman numerals** in the UI: `Level XII`.

*Pacing check:* ~10 fights/day at 40–120 XP lands a diligent player at level 12 in **19–22 real
days**. Tune `turnsPerDay` or the XP table — never both.

### 3.6 Monsters (forest encounters)

Pick uniformly within the player's tier, then scale.

| Tier | Player lvl | Monster | HP | Atk | XP | Gold |
|---|---|---|---|---|---|---|
| 1 | 1–2 | Field Rat | 8 | 4 | 12 | 6 |
| 1 | 1–2 | Starving Dog | 10 | 5 | 15 | 8 |
| 1 | 1–2 | Mud Kobold | 12 | 6 | 18 | 12 |
| 2 | 3–4 | Goblin Scout | 22 | 9 | 30 | 20 |
| 2 | 3–4 | Restless Skeleton | 26 | 10 | 34 | 24 |
| 2 | 3–4 | Grave Slime | 30 | 8 | 28 | 30 |
| 3 | 5–6 | Orc Brute | 45 | 15 | 55 | 45 |
| 3 | 5–6 | Ghoul | 40 | 17 | 60 | 40 |
| 3 | 5–6 | Road Bandit | 48 | 14 | 58 | 90 |
| 4 | 7–8 | Ogre | 75 | 22 | 95 | 80 |
| 4 | 7–8 | Wraith | 65 | 25 | 110 | 70 |
| 4 | 7–8 | Hill Giant | 90 | 20 | 100 | 120 |
| 5 | 9–10 | Cave Troll | 120 | 30 | 150 | 140 |
| 5 | 9–10 | Dark Knight | 110 | 33 | 165 | 180 |
| 5 | 9–10 | Wyvern | 130 | 31 | 175 | 160 |
| 6 | 11–12 | Pit Demon | 165 | 40 | 240 | 260 |
| 6 | 11–12 | Lich | 150 | 44 | 260 | 240 |
| 6 | 11–12 | Young Dragon | 180 | 42 | 255 | 300 |

**The Ashen Wyrm:** HP 400, Atk 45, attacks twice every third round. Level 12 only. No XP/gold —
the reward is the ending.

### 3.7 Items

**Weapons**

| Item | Dmg | Price |
|---|---|---|
| Rusty Dagger | 3 | starting |
| Short Sword | 6 | 120g |
| Hand Axe | 8 | 300g |
| Long Sword | 11 | 700g |
| War Hammer | 14 | 1,400g |
| Two-Handed Sword | 18 | 2,600g |
| Runed Blade | 23 | 5,000g + 2 gems |

**Armor**

| Item | Def | Price |
|---|---|---|
| Rags | 1 | starting |
| Leather | 3 | 100g |
| Chain Mail | 6 | 350g |
| Scale Mail | 9 | 800g |
| Plate Mail | 13 | 1,800g |
| Dragon Scale | 18 | 6,000g + 5 gems |

Shop buys back at **40%** of list price. Selling is required — it is the gold-sink relief valve.

### 3.8 Spells (Magician only)

| Spell | Mana | Effect |
|---|---|---|
| Spark | 2 | 8 + level×2 damage, ignores armor |
| Ward | 3 | +6 DEF for the rest of the fight |
| Drain | 4 | 6 damage, heal half of it |
| Sleep | 5 | 45% chance to skip the monster's next attack |
| Fireball | 7 | 20 + level×3 damage |

Casting replaces the physical attack on your turn.

### 3.9 Special forest encounters

Trigger on **1 in 8** forest turns instead of a monster. Does **not** consume the turn if the
encounter is purely narrative.

- **The Wounded Soldier** — give 50 gold → +40 XP and +2 Charm. Refuse → nothing.
- **The Gypsy** — gamble 1 gem → 50% double, 50% lose.
- **A Beautiful Stranger** — Charm check (difficulty 12) → +1 Charm, else she lifts 10% of gold.
- **The Dying Wizard** — Magician: learn a spell permanently at discount. Others: receive 1 gem.
- **The Shrine** — pray → random: full heal / +1 stat / −20% gold / nothing.
- **The Peddler** — cursed blade (+6 dmg, −3 DEF) for 200g. Yes/no.

### 3.10 Death and resurrection

On HP ≤ 0 (forest or PvP):

- Lose **25% of carried gold** (banked gold safe).
- Lose **10% of current-level XP progress** (never de-level).
- Revive at the Healer at 50% HP. `{dim}You awaken on a straw pallet. Someone has taken your purse.{/}`
- Death does **not** consume an additional turn.

### 3.11 Bank

Deposit/withdraw gold. Banked gold is **safe from death and PvP theft**. Interest **+2% per day
rollover, capped at 5,000 gold banked.** This is the best gold sink in the design — it teaches
prudence, which is the entire point of a banking screen in a game about risk.

### 3.12 PvP

- Target within **±2 levels** of the attacker.
- Costs 1 turn.
- Winner takes **15% of the loser's carried gold** (never banked) and gains `playerKills + 1`.
- Losing costs the defender **no** turn.
- Thief special: **Steal** — 60% success, takes 10% carried gold, no combat, costs a turn, and
  writes a public notice to the realm feed.
- `playerKills` and `deaths` live on the character sheet. The realm remembers.

### 3.13 Wren (the Inn subplot)

Five stages, advanced by talking to her at the Inn. Each stage needs a Charm check or a gift.

| Stage | Requirement | Unlocks |
|---|---|---|
| 1 | Talk | She remembers your name |
| 2 | Buy her a drink (20g) | Small talk, rumor hints |
| 3 | Charm ≥ 10 | She tells you about the wyrm's lair |
| 4 | Gift a ring (500g) | She agrees to wait for you |
| 5 | Slay the wyrm | **Marriage ending**, permanent title `Wren's Beloved` |

Stage 3 grants a real mechanical hint: the wyrm's second-attack rhythm, phrased in character.

### 3.14 The Ashen Wyrm and the endgame

- Unlocks at level 12. Hub shows `[D] — The Ashen Wyrm's Lair`.
- One attempt per day regardless of remaining turns.
- **Win:** character marked `Wyrmbane`, inserted into the Hall of Fame with date, and offered
  **Retire** (character frozen, entry permanent) or **Continue** (title retained, wyrm respawns
  after 7 days at +25% difficulty).
- **Lose:** normal death rules plus `{red}The wyrm's laughter follows you out of the cave.{/}`

### 3.15 Hall of Fame / Who's Who

- **Who's Who** — top 10 living characters by XP: `Rank | Name | Class | Lvl | Kills | Title`
- **Hall of Fame** — all Wyrmbanes, oldest first: `Date | Name | Days Taken`

---

## 4. Terminal UX specification

### 4.1 Screen model

- Virtual **80×25 character grid**, rendered as real DOM text (semantic elements + `<pre>` with
  spans) — **never a canvas.** Accessibility and text selection depend on it.
- **Header (rows 1–2):** realm name, node ID, player name, level, HP bar, turns, gold.
- **Body:** scrolling narrative output, `role="log"`, `aria-live="polite"`.
- **Footer:** current menu, right-aligned clock.

### 4.2 Input

- **Keyboard only** for primary interaction. Single-keypress menu selection, no Enter required.
- Menu: `[F] Fight  [I] Inn  [B] Bank  [S] Shop  [H] Healer  [C] Character  [W] Who's Who  [P] Attack  [D] Wyrm  [Q] Quit`
- Blinking underscore prompt at the input line: `> _`
- **Cursor spec:** `_` glyph, 530ms on / 530ms off, `animation: blink 1.06s step-end infinite`.
  Cursor goes **solid** while output is typing, resumes blinking when idle.
- Any keypress **skips the typewriter**; the next keypress acts.
- No mouse during play. A visible `?` opens keyboard help (required for accessibility, §5.5).

### 4.3 Output pacing

- Typewriter at **~18ms per character**, faster for `{dim}` text.
- Never block longer than **400ms** on a single line for the skip handler.
- "Fast" toggle in settings; `prefers-reduced-motion` forces it on.

### 4.4 Inline markup

```
{bright}  bright green     {dim}  dark green     {red}   red
{gold}    amber            {white} near-white    {/}     reset
{pause}   120ms break
```

Sample:

```
You step into the clearing. {dim}Something is breathing.{/}
{bright}An Orc Brute{/} lurches out of the treeline!
```

### 4.5 Boot sequence (do not skip)

```
BKM REALM NODE 01 ........................ READY
2400 BAUD ................................. OK
CARRIER DETECT ............................ OK
LOADING WYRM.SYS .......................... OK

     L E G E N D   O F   T H E
         A S H E N   W Y R M

   (c) a new realm. type ? for help.

WHAT IS YOUR NAME?
> _
```

Runs once per session; skippable with any key after the ASCII art appears.

---

## 5. Visual design: green CRT

### 5.1 Palette

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#050805` | Screen black (never pure `#000`) |
| `--green` | `#33FF66` | Primary phosphor |
| `--green-bright` | `#B6FFC6` | Highlights, cursor |
| `--green-dim` | `#1F7A38` | Secondary text, borders |
| `--green-ghost` | `#0E2A18` | Disabled, faint rules |
| `--amber` | `#FFB000` | Alternate theme + warnings |
| `--red` | `#FF5A4E` | Damage, death |

Ship an **amber theme** (`#FFB000` on `#0A0700`). Amber-terminal people are a real constituency.

### 5.2 Type

- `font-family: "VT323", "IBM Plex Mono", ui-monospace, monospace` — **no CDN.** Summon the system
  stack; no webfont download.
- 18px base, 1.5 line-height on the 80-col grid, `letter-spacing: 0.02em`.
- `text-shadow: 0 0 2px currentColor, 0 0 8px rgba(51,255,102,0.35)` for phosphor bloom.

### 5.3 Effects — layered, each independently toggleable

1. **Scanlines** — `repeating-linear-gradient(to bottom, rgba(0,0,0,0.22) 0 1px, transparent 1px 3px)`, `pointer-events:none`, fixed overlay.
2. **Vignette** — `radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.65) 100%)`.
3. **Barrel curvature** — `perspective(1200px) rotateX(0.4deg)`, under 1% distortion or text dies.
4. **Flicker** — `@keyframes flicker { 0%,97%{opacity:1} 98%{opacity:.94} 100%{opacity:1} }` at ~7s.
5. **Grain** — inline SVG `feTurbulence` at 3% opacity, `mix-blend-mode: overlay`.
6. **Power-on** — white line expands from center over 220ms, then fades in.

**Contrast guard:** `#33FF66` on `#050805` ≈ 11:1 — comfortable. Effects must never drop it below 7:1.

### 5.4 Sound (optional, off by default)

Web Audio only, no files: 4ms square-wave keyclick at −30dB, low thud on hit, rising arpeggio on
level-up. Gated behind an explicit user gesture.

### 5.5 Accessibility — non-negotiable

- `prefers-reduced-motion: reduce` → disable flicker, grain, scanline animation, power-on, and
  typewriter (instant text).
- Real DOM text everywhere; `aria-live="polite"`, `role="log"` on the narrative region.
- Keyboard-only is the default. Visible focus ring on settings controls.
- Settings: **Scanlines / Flicker / Grain / Curvature / Sound / Typewriter speed / Theme / Contrast boost**.
- A CRT aesthetic that excludes people is a badly built CRT aesthetic.

---

## 6. Technical architecture

### 6.1 Stack

- **Vite + React + TypeScript** (strict).
- **Zero runtime dependencies** for game logic. No state library, no UI kit.
- Plain CSS with custom properties (not Tailwind — it fights the pixel-precise grid).
- Engine is **pure functions**, no React imports: unit-testable and server-portable.

### 6.2 Folder structure

```
src/
  engine/          # pure TS, framework-free
    types.ts       rules.ts        rng.ts
    combat.ts      progression.ts  economy.ts
    encounters.ts  pvp.ts          dragon.ts
    save.ts        # schema + migration + day rollover
  content/         # data only, no logic
    monsters.ts    items.ts   spells.ts
    encounters.ts  strings.ts bots.ts
  state/
    SaveStore.ts          # interface
    LocalSaveStore.ts     # localStorage impl
    RealmStore.ts         # interface (who's who, feed, hall of fame)
    BroadcastRealmStore.ts
    useGame.ts            # React binding over the engine
  ui/
    Terminal.tsx   Typewriter.tsx  Markup.tsx
    Header.tsx     Menu.tsx
    screens/       # Boot Title Create Hub Forest Shop Bank
                   # Healer Inn PvP Dragon HallOfFame Character Settings
  styles/crt.css
tests/
  engine.spec.ts  playthrough.spec.ts
```

### 6.3 Save schema

```ts
interface SaveFile {
  version: 1;
  realmId: string;
  character: {
    name: string; sex: 'm' | 'f'; class: 'warrior' | 'magician' | 'thief';
    level: number; xp: number; hp: number; maxHp: number; mana: number;
    str: number; def: number; agi: number; chm: number;
    gold: number; banked: number; gems: number;
    weaponId: string; armorId: string;
    turnsRemaining: number; lastTurnResetDay: string;   // 'YYYY-MM-DD' UTC
    playerKills: number; deaths: number; wrenStage: number;
    isWyrmbane: boolean; retired: boolean; createdAt: string;
    wyrmAttemptDay: string | null;
  };
  hallOfFame: HallEntry[];
  realmFeed: FeedEntry[];    // last 25 PvP / steal notices
  settings: Settings;
}
```

**Migration:** `if (save.version < CURRENT) migrate(save)`. Never silently drop a save.

### 6.4 RNG

`mulberry32` seeded from `crypto.getRandomValues`. Expose a seed override in dev so fights are
reproducible. **Never call `Math.random()` in engine code** — inject the RNG.

```ts
export function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

### 6.5 Tuning surface

Every number in §3 lives in **one exported object** in `rules.ts`. No magic numbers anywhere else.

---

## 7. Multiplayer (Phase 1.5) — the decision

The BBS original's soul was *other people on the node*. Here is how we get that without a server.

### 7.1 Layer 1 — same-browser realm (real multiplayer)

- Characters are stored in `localStorage` under a shared realm key, **one slot per character**.
- A `BroadcastChannel('ashen-wyrm-realm')` publishes realm events (fight results, PvP attacks,
  thefts, level-ups, wyrm kills) to **every open tab instantly**.
- Open the game in two tabs, create two characters, and they are genuinely in the same realm: they
  see each other in Who's Who, can attack each other, and the feed updates live.
- `storage` events are the fallback when `BroadcastChannel` is unavailable.

### 7.2 Layer 2 — the resident adventurers (bots that behave like players)

- **Six resident characters** live in the realm from the start, covering the three classes.
- They are ordinary `Character` records — no special-casing in combat or PvP code.
- An **offline progression tick** runs on load and on every day rollover: each resident spends their
  turns (weighted by class), earns XP/gold, buys gear at price tiers matching their level, and levels
  up. Fast-forwarded, capped so they never outrun a diligent player.
- They can attack the player **only** when level-gated into range, and their raids appear in the feed
  as ordinary PvP notices. `{dim}Grimwold the Unshod has taken 34 gold from you while you slept.{/}`
- This is the "there is always someone else on the node" feeling. It is *simulated*, and the README
  says so plainly — no pretending bots are humans.

### 7.3 Interfaces frozen now

`SaveStore` and `RealmStore` are interfaces with local implementations. Phase 2 swaps in
`RemoteSaveStore` / `RemoteRealmStore` hitting `/api/save` and `/api/realm`; turn reset and PvP
resolution move server-side. **The engine package does not change between phases** — it is pure
functions over plain data and runs on Node unchanged.

### 7.4 Trust model, stated honestly

Phase 1 trusts the client clock. Turn resets can be gamed with devtools. The README says so in plain
language and names the fix (server-side resolution). We do not pretend otherwise.

---

## 8. Content deliverables checklist

All in `src/content/`, mostly `strings.ts`.

- [ ] Boot sequence copy (5 lines + ASCII title)
- [ ] Title/menu screen copy
- [ ] Character creation prompts + 3 class descriptions
- [ ] Hub menu copy (all 10 options)
- [ ] Combat messages: hit, miss, crit, monster hit, victory, defeat — 3+ variants each
- [ ] 18 monster descriptions (one line each)
- [ ] 7 weapon + 6 armor shop descriptions
- [ ] 5 spell descriptions
- [ ] 6 special-encounter scenes (3–6 lines each)
- [ ] Bank / Healer / Shop greeting copy
- [ ] Wren dialogue, 5 stages (3–4 lines each)
- [ ] Wyrm intro, victory, defeat text
- [ ] Death message set (3 variants)
- [ ] Hall of Fame + Who's Who headers
- [ ] 12 title strings
- [ ] Error states: not enough gold, no turns left, level too low, name taken
- [ ] 6 resident adventurer bios
- [ ] README trust-model note

**Voice guide:** terse, second person, present tense. Dry humor, never winking at the player. Short
lines — this is a modem-era text game, not a novel.

> `The blade turns in your grip. It is not a good blade.`
> `{dim}You have 3 turns remaining.{/}`

---

## 9. Milestones / acceptance criteria

- [ ] **M1 — Engine (no UI).** Combat resolves, XP awards, levels up at exact thresholds, day
      rollover grants exactly 10 turns once, bank interest caps correctly. Unit-tested.
- [ ] **M2 — Playable loop.** Boot → create → fight 10 monsters → buy a sword → quit → reload →
      state identical.
- [ ] **M3 — Full content.** All locations, PvP vs. residents, Wren 1–5, wyrm fight, hall of fame,
      death/resurrection, bank interest.
- [ ] **M4 — CRT polish.** Power-on, typewriter, blinking cursor, scanlines, green/amber, settings
      persistence.
- [ ] **M5 — Accessibility pass.** Reduced motion respected, `aria-live` narrative region,
      keyboard-only traversal of settings, 7:1 contrast verified.
- [ ] **M6 — Realm.** Two tabs see each other; residents progress overnight; feed updates live.

**Definition of done:** a player can go from boot to Wyrmbane in a simulated 20-day run driven by a
test harness, with saves surviving reload at every step.

---

## 10. Testing

- **Vitest** for engine unit tests.
- Property tests on the level table: XP never decreases, level never decreases, `maxHp` monotonic.
- A **headless playthrough harness** (`tests/playthrough.spec.ts`) that primes the RNG seed and runs
  20 simulated days, asserting the character reaches level 12 and can complete the wyrm fight.
- Snapshot the parsed terminal output for 3 screens only — heavy snapshotting makes refactors
  miserable.
- Manual QA matrix: green/amber × reduced-motion on/off × typewriter instant/slow.

---

## 11. Legal & naming

*Legend of the Red Dragon* and its characters are **Seth Able Robinson's** work, distributed
historically as shareware. This build stays clean:

- **Do not** copy the original's ANSI art, text strings, distinctive monster names, or assets.
- **Do not** ship the original title or the character name "Violet."
- **Do** build an original game mechanically inspired by the genre — daily turns, forest grinding, a
  dragon at the end. Genre mechanics aren't protectable; expression is.
- **Shipped name:** *Legend of the Ashen Wyrm*. Inn subplot character: **Wren**. Endgame boss: **the
  Ashen Wyrm**. Player title on victory: **Wyrmbane**. Resident NPC names are original.

---

## 12. Open questions — resolved

1. **Phase 1 scope** → client-side, *with* a real shared realm: same-browser multiplayer over
   `BroadcastChannel` plus six simulated resident adventurers (§7). Not a lone-offline game, not yet
   a server.
2. **Realm size** → **one realm, one node** (`BKM REALM NODE 01`). Multiple realms are a later
   concern; the node framing is more faithful to a BBS anyway.
3. **Content tone** → **PG-13.** The inn subplot is warm and lightly flirtatious, never crude. No
   content that would embarrass someone reading over a shoulder.
4. **Title** → *Legend of the Ashen Wyrm*. Alternatives considered and rejected: *Redgate* (reads as
   a networking product), *The Green Dragon's Toll* (too close to the original's silhouette).

---

## 13. The three things most likely to get botched

In order of likelihood:

1. **Scattering tunable numbers** through the codebase instead of using `rules.ts`.
2. **Building the terminal as a canvas**, torching accessibility and text selection.
3. **Skipping the day-rollover idempotency check**, handing out infinite turns.

Guard those and the rest is content.

---

## 14. A note on craft

The progression curve is just arithmetic, and you get to *feel* it — 19,000 XP, ten turns a day,
nineteen days, and the wyrm. There's real craft in tuning an exponent until a game feels like a
season of your life. Play with the numbers, break the pacing, put it back.

And a small nod to St. Isidore of Seville — patron of the internet — who presumably has opinions
about whether your scanlines are subtle enough. Go keep the old modem faith.
