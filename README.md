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
npm run dev      # starts BOTH the game server (:8787) and the client (:5173)
npm test         # engine + playthrough + audio
npm run build
```

`npm run dev` runs the server and client together under `concurrently`. If you
want them separately:

```bash
npm run server   # the authority, on :8787
npm run client   # Vite, on :5173, proxying /api to the server
```

Keyboard only. Any keypress skips the typewriter; the next keypress acts.

```
[F] Forest    [I] Inn       [K] Bank      [S] Shop
[H] Healer    [C] Character [W] Who's Who [P] Attack
[D] Wyrm      [Q] Quit      [?] Help      [B] Back
```

Bank is `K` because `B` is Back on every screen. One key, one meaning.

Typing is a mechanical keyboard, not a beep — see §Audio. Combat sounds are
chosen by your kit: a dagger, a sword, an axe, a hammer and a wand are separate
designs, not one sound transposed — see §Combat by loadout.

---

## What this is

A single realm on a single node, `BKM REALM NODE 01`. You get ten turns a day.
Fights cost a turn; shopping, banking, healing, and talking to Wren are free.
Turns reset once per UTC day. Reach level XII and the mountain opens.

The endgame is a 400 HP wyrm that strikes twice every third round. Wren tells you
that, in character, at stage three of the inn subplot — it is a real mechanical
hint wearing a conversation.

The boot sequence opens with a synthesised modem handshake: dial tone, DTMF, the
2100 Hz answer tone, the V.8 beep-boop menu, the training screech, and a carrier
settling into the CRT. All of it is generated at runtime from oscillators and one
reused noise buffer. No audio files.

Before you dial in, the room is a maintenance room: relay ticks, a fan, a drive
spooling up, a terminal doing something you did not ask it to do. When the carrier
settles that goes away and the world starts breathing instead.

---

## Architecture — client / server

**The browser holds no game rules.** It renders text and sends keypresses.

```
src/                      THE CLIENT — presentation only
  App.tsx                 shell, keyboard, boot phase machine, scrolling
  api/client.ts           the entire relationship with the server (2 calls)
  api/wire.ts             the response shape. no rules, no stats, no tables
  api/types.ts            client-owned types, deliberately duplicated
  state/client.ts         rendered screen + log, no simulation
  state/useGame.ts        the only side effects: fetch, persist settings, audio
  audio/                  synthesised sound — see §Audio. no files.
    Voice.ts              types + volume steps
    catalogue.ts          every sound, as data
    waves.ts              band-limited waves + impulse response
    render.ts             SoundDesign → audio graph
    handshake.ts          the modem, as a timeline
    scenes.ts             the five room palettes, as data
    ambience.ts           renders a scene + crossfades between them
    keyboard.ts           the mechanical keyclick, in four events
    SoundEngine.ts        context, throttling, volume, ambience
    cues.ts               server prose → which sound
  ui/                     Crt, Header, TerminalLog, Markup, screens/
  styles/crt.css          custom properties, no framework

server/                   THE AUTHORITY — every rule
  index.ts                HTTP: POST /api/session, POST /api/command
  game.ts                 the realm, sessions, ownership, day rollover
  store.ts                SQLite persistence (sql.js)
  wire.ts                 what crosses the socket
  flow.ts                 pure action → Step
  engine/                 pure TS: rules, combat, progression, economy,
                          encounters, pvp, dragon, save, creation, rng
  content/                data only: monsters, items, spells, bots, strings

scripts/                  smoke.ts (HTTP), audit.ts (security),
                          persistence.ts (restart proof), rollover.ts
data/                     realm.sqlite — created on first run
tests/                    engine, playthrough, audio
```

Three seams matter:

1. **`server/engine/rules.ts`** — every tunable number in the design lives in one
   exported object. Balance changes are one-file changes.
2. **The wire** — `Screen` is a rendered screen, not a simulation. It carries no
   XP table, no monster stats, no item prices, no damage formula.
3. **`flow.ts`** — every player action is a pure function returning new lines,
   the new character, the next view, and any prompt.

`scripts/verify-bundle.mjs` proves the boundary: it reads the production bundle
and fails if a rules file leaked into it. Currently clean.

### Design decisions worth naming

- **The terminal is DOM text, not a canvas.** Every line is a `<span>`. Text is
  selectable, screen-readable, and searchable.
- **Audio is synthesised, not sampled.** Zero audio assets, ~9 kB of code.
- **The day rollover is idempotent.** Calling it twenty times in one day grants
  ten turns once. It runs on every command.

---

## Trust model — read this

**The server decides everything. The client cannot cheat at dice.**

Turns, XP, gold, death, and the wyrm are resolved on the server. Editing
`localStorage` gets you a settings preference and nothing else. Calling
`/api/command` from the console can only send a keypress — the same keypress the
UI would send.

**What is still not protected, stated plainly:**

1. **Sessions never expire.** `issued` is an in-memory `Set` with no TTL, and the
   token is the only credential. Treat it like a password.
2. **`access-control-allow-origin: *`.** Fine for local play; do not deploy as is.
3. **Day rollover trusts the server clock**, which is now the *right* clock to
   trust. Setting your machine's date forward does nothing.
4. **SQLite is a single writer.** One process, one file. Right for a node with a
   handful of players; not a foundation for many.

### Persistence

Characters live in SQLite at `data/realm.sqlite` and survive a restart. That is
proven, not assumed: `scripts/persistence.ts` creates a character, **kills the
server process**, starts a new one against the same file, and asserts the
character is still there with the same turn count. It passes.

Why `sql.js` and not the obvious choices:

- **`node:sqlite`** ships with Node 22 — and in this WebContainer it imports
  successfully and constructs an object with **no methods at all**. A stub. Code
  written against it would pass review, pass tests, and silently discard every
  write. Found by probing the instance, not by trusting the docs.
- **`better-sqlite3`** needs native compilation. Impossible in a WASM container.
- **`sql.js`** is SQLite compiled to WASM. No bindings, no node-gyp, works.

The schema is deliberately boring: one row per character with a JSON blob. The
engine already speaks `SaveFile` — plain data, no cycles — so the database does
not need to model armour in normal form. It needs a character to survive a
reboot, and the engine remains the source of truth for the shape.

Writes go to a temp file and are renamed into place, so an interrupted write
leaves the previous good file rather than a truncated one.

Session tokens are deliberately *not* persisted: a restart invalidates the
handshake, but the character it pointed at is intact. Reload the page, get a new
token, pick your character.

### What changed and why

Two exploits existed and were found by `scripts/audit.ts`, not by the unit tests.
Both are now closed:

- **Character hijack.** The title screen lists every character in the realm, and
  pressing a digit used to copy that slot's save into the caller — *including
  someone else's*. A second session could take over a character and spend its
  turns. Fixed with an `owner` map: a slot is loadable only by the session that
  created it. Tried again after the fix: `HIJACKED? no`.
- **Turns never came back.** `rolloverDay` existed and was well tested, but
  nothing in the server ever called it. Spend your ten turns and you were stuck
  at zero forever — the central premise of a daily-turns game, quietly broken.
  Now called on every command, with a "A new day on the node" line when it fires.

The lesson worth recording: unit tests over pure functions cannot catch "nobody
wired this up". The integration scripts exist for exactly that.

---

## Persistence and multiplayer

**There is no client-side save any more.** That whole layer was removed when the
server became authoritative. What remains:

- **One realm, one node.** Every session shares the world: residents, hall of
  fame, realm feed.
- **Several characters.** Each session creates its own; the title screen lists
  them all but only lets you load the ones you made.
- **The residents** are six simulated adventurers. They progress between
  sessions, appear in Who's Who, and can attack you while away. **Every list tags
  them `[sim]`**; your own row is `[you]`. They are not people and the UI does
  not pretend otherwise.
- **No cross-machine multiplayer.** One server process, one realm, one SQLite
  file. Two people on two machines need a deployed backend; the local one is not
  shared across the network.

---

## Accessibility

- Real DOM text throughout; the narrative region is `role="log"` with
  `aria-live="polite"`. Boot state is announced via a `role="status"` region.
- `prefers-reduced-motion: reduce` disables flicker, grain, curvature, the
  power-on animation, the typewriter, and the dial prompt's pulse.
- Keyboard-only by default. The settings panel is the one place with focusable
  buttons.
- Phosphor on screen-black is roughly 11:1; the CRT layers are tuned to keep body
  text above 7:1. A contrast-boost toggle exists.
- Amber theme included. Amber-terminal people are a real constituency.

---

## Audio

Everything is synthesised at runtime. Zero audio files, zero downloads.

### Why it was rebuilt

The first pass worked but sounded cheap, for five identifiable reasons. Naming
them because they are the usual suspects in any browser game:

1. **Raw `square`/`sawtooth` oscillator types alias.** A true square contains
   every odd harmonic to infinity, and everything above Nyquist folds back as
   inharmonic garbage. That fizz is the difference between "1989 hardware" and
   "cheap beep". Every timbre is now a **band-limited `PeriodicWave`** built from
   an explicit harmonic series, sized to the pitch so nothing folds.
2. **One shared lowpass for tone and noise.** A 200 Hz body and a 3 kHz crack
   cannot share a filter; one is always wrong. They now have separate filters.
3. **No envelope body.** A gain that ramps up and straight back down is a swell,
   not an impact. Impacts now use a fast attack then a *continuous decay* across
   the whole duration — which is what a struck object actually does.
4. **Unbudgeted gains.** Layered voices summed past unity and squashed into the
   compressor. Every design is now budgeted to peak under 0.45; a test enforces
   it.
5. **No space, no variation.** Everything was bone dry and bit-identical. There
   is now a synthesised plate-ish reverb (a send, not an insert), stereo scatter,
   and a few cents of pitch jitter per repeat.

### The architecture

Audio is **data, not code**. A module split, so the description of a sound is
separate from its rendering:

```
src/audio/
  Voice.ts        the vocabulary — SoundDesign, Voice, volume steps. No imports.
  catalogue.ts    every sound, as data. ~17 designs, no rendering.
  waves.ts        band-limited PeriodicWave + synthesised impulse response.
  render.ts       SoundDesign → audio graph. ADSR, filters, pan, sends.
  handshake.ts    the modem, as an eleven-phase timeline.
  ambience.ts     the room tone: a bed plus irregular events.
  SoundEngine.ts  the surface: context, throttling, volume, delegation.
  cues.ts         server prose → which sound to play.
```

The split matters practically: the catalogue can be tuned forever without
touching the renderer, and **a test can assert on a sound without an
AudioContext** — "every design is layered", "nothing clips", "the keyclick stays
out of the reverb" are all typecheckable facts now.

### The room tone

Ambience is **places**, not one bed. A town square, an inn and a mountain cave are
three different rooms, and a game that plays the same wind in all of them has told
you nothing about where you are. So each place is a recipe in `scenes.ts`, and
`ambience.ts` renders whatever recipe it is handed.

Five scenes, moved between by crossfade:

| Scene | Bed | Events |
|---|---|---|
| `machine` | air hiss, fan, mains hum, ventilation | ticks, whirrs, relays, drives, vents |
| `forest` | sub-bass mass, wind (2 LFOs), sky air | gusts, rustle, birdsong, creaks, drips |
| `town` | distant murmur, street air, stones | doors, carts, murmurs, dogs, bells |
| `cave` | deep pressure, draught, water | drips, rockfall, groans |
| `lair` | breath at the floor of hearing, ash | near-silence on purpose |

**The boundary that matters:** before the modem, the player is in a *maintenance
room*. That palette is mechanical, periodic and cold — deliberately unlike the
forest — so the moment the carrier settles and the world opens, the shift does the
work a paragraph of prose would otherwise have to do. The transition happens when
the call ends, not when it starts, because the modem is an object *in* that room.

Three rules shaped the whole thing, and most attempts at ambience break at least
one:

1. **Never compete with the narrative.** It sits at roughly a tenth of a keyclick.
   If you notice it as a *feature* rather than as a room, it is mixed wrong.
2. **No loops.** Every bed is continuous noise or a detuned oscillator pair, and
   every modulated layer is driven by two LFOs at rates that do not divide (0.037
   and 0.011 Hz), so nothing completes a cycle inside a session.
3. **Not constant.** The gaps matter more than the events: 9–34 seconds outdoors,
   with a 22% chance of nothing at all. The lair is *almost silent* on purpose — a
   room that quiet is a threat, and filling it with noises makes it an attraction.

### Why it sounds natural

Four properties, in order of how much they do:

- **Every event jitters pitch, gain and duration.** Twelve ticks are twelve
  different ticks. This single property does more for realism than any amount of
  layering, and a test asserts it by recording the frequencies actually scheduled.
- **Gaps are humanised twice** — drawn from the scene's range, then nudged again —
  so even the rhythm never settles into a period.
- **Envelopes are asymmetric.** Slower attacks on air, faster on impacts. A
  symmetric envelope reads as synthetic.
- **Events are stacks.** A drip is a drop *and* its reflection; a relay is a click
  *and* the chassis taking the load. A drop with no answer is a drop in a wardrobe.

It is switchable separately from the effects, because some people want the
keyclicks and not the drone.

### The keyboard

The keyclick is the most-heard sound in the game — tens of thousands of times in a
session — so it lives in its own module and gets its own suite.

**A mechanical key is four events, not one**, and imitations usually model only
the first:

1. **The press** — the switch contact. A dry high transient, milliseconds long.
2. **The bottom-out** — the cap hitting the plate, 152 Hz falling to 94. This is
   the *clack* people actually mean, and it is a mass event, not a click.
3. **The plate ring** — the case resonating at ~620 Hz for 65 ms. The most
   under-modelled layer, and the one that gives the board a *body*. A click has no
   case; a keyboard does.
4. **The release** — higher and quieter, arriving at a gap set by how long the key
   was held.

**The gap is the point.** `atJitter` on the release voices varies the
press-to-release interval by ±22 ms every keystroke, because that interval *is*
how long a human held the key. Without it the pair is mechanically identical every
time, and the ear identifies the sample within about four keys.

**Three axes of variation**, so consecutive keystrokes are different *objects*
rather than detuned copies of one object:

| Axis | Mechanism | Effect |
|---|---|---|
| Pitch | `jitter: 30` cents | a slightly different cap |
| Velocity | `gainJitter: 0.18` | a slightly different force |
| Character | two alternate stacks | a slightly different *keyboard* |

The alternates are a heavier cap (lower ring, louder bottom-out) and a lighter one
(brighter transient, thinner body). Pitch jitter alone cannot do this — it changes
the note without changing the object.

**Bone dry.** The design carries no reverb send anywhere, and two tests enforce
that across *every* stack. A wet keyclick reads as someone else typing in another
building; the board is thirty centimetres from your ears. The body comes from
frequency and decay, not from space.

**Throttled at 18 ms** so held-key repeat rolls rather than stacking into a buzz,
and budgeted well under the combat sounds so typing through it for an hour is
comfortable.

### Starting kits are per class

A magician opening with a rusty dagger is a warrior with worse numbers: the class
choice would not read as a choice until the spells arrived at level five. So the
kit is decided by class — **Weak Wand** (2 damage) and **Cloth Robes** (2 armor)
against the warrior's dagger (3) and rags (1).

The wand is deliberately *worse* than the dagger. It is a stick. That is the
joke, and the compensation is Spark, which ignores armor entirely.
`sellEquipped` falls back to the *class's* starter rather than a hardcoded
dagger, because otherwise selling a sword would silently turn a magician into a
warrior.

### The title screen reveals in stages

It used to appear fully formed, which caused a real bug: the screen is a
scrolling container, so the roster and menu pushed the ASCII wordmark above the
fold — **the first thing a new player saw was the bottom of the title screen**,
and "LEGEND" was invisible without scrolling up.

The art, tagline, roster and menu now arrive on a 0 / 260 / 620 / 980 ms
schedule, with the scroll pinned to the top while it builds. Elements are laid
out from the first frame and only their opacity animates — hiding stages would
make the page short and then grow, which is the mechanism that pushed the
wordmark away in the first place. Under `prefers-reduced-motion` everything is
present immediately: a reveal is motion.

### The handshake

Eleven phases over ~6.7 seconds, compressed from a real fifteen-to-twenty-five
second V.32bis negotiation by shortening every phase rather than deleting any.
Frequencies are the real ones where the standards fixed them: 350+440 Hz dial
tone, real DTMF pairs, 440+480 ringback, 2100 Hz answer tone **with its phase
reversal** (the "bzzt" hiccup that makes it sound recorded), 1100 Hz CI, V.8
menu pairs, band-swept training noise, and a rapid frequency-hopping data burst.

**The boot screen no longer owns a `HANDSHAKE_MS` constant.** It used to: a
literal `5900` in `App.tsx` that a comment asked you to keep in sync with the
timeline in the engine. Two numbers, two files, nothing enforcing agreement — and
the failure mode is subtle, because claiming the carrier is up 200 ms early makes
the modem talk over the menu, which reads as a game bug rather than a typo. The
engine now reports its own duration and the shell waits on that.

### Volume

Four perceptual steps (LOW / MED / HIGH / MAX) rather than a slider. A slider in a
keyboard-only terminal means arrow keys doing double duty. Changing the step plays
a sword hit, because "LOW" is meaningless until you have heard it.

### The constraint worth knowing

Browsers refuse to start an `AudioContext` without a user gesture. So the modem
cannot be the literal first thing on page load — but it is the first thing after
the first key, which is why the boot screen asks you to dial in. The fiction and
the platform rule happen to agree, which is luckier than it sounds: a BBS always
began with you picking up the phone.

`resume()` is **asynchronous**, and an earlier version checked `ctx.state ===
'running'` before scheduling — so the handshake was silent on the first gesture
and worked on the second. The fix is structural: scheduling never depends on
context state, and `unlocked` means "we have a context", never "resume has
settled". Tests pin this with a fake context that stays suspended until a
microtask resolves.

---

## Pacing

Level XII needs 19,000 XP. Reaching that takes roughly 200 forest victories, and a
1-in-8 encounter rate caps a day at about 8.75 fights — so **~23 days** of
unfailing play is the arithmetic floor, not the 19–22 the design document
optimistically claimed. The harness asserts the journey completes within a
generous budget rather than a figure the maths does not support.

One deliberate addition to the spec: a 6% gem drop on won fights. Gems gate Dragon
Scale armor, and that armor is what makes the 400 HP / 45 attack wyrm survivable.
Without a steady trickle the endgame is mathematically unreachable, which is a bug
rather than a challenge.

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
3. Skipping the rollover idempotency check, handing out infinite turns — or, as
   actually happened, writing the check and never calling it.

All three are guarded now, and #3 is guarded twice: unit tests for the function,
and `scripts/audit.ts` against the running server.
