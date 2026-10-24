/**
 * AUDIO DIAGNOSTIC — a strict WebAudio mock.
 *
 * The audio tests use permissive fakes: every parameter method is a spy that
 * accepts any value. That is correct for asserting graph *shape*, and useless
 * for finding the class of bug that silences a game in a real browser, because
 * the real Web Audio API throws on inputs a fake happily swallows.
 *
 * This harness enforces what browsers actually enforce:
 *
 *   - `exponentialRampToValueAtTime` rejects a target <= 0  (RangeError)
 *   - automation rejects NaN / Infinity times or values     (TypeError)
 *   - automation rejects negative times                     (RangeError)
 *   - `stop()` before `start()` throws                      (InvalidStateError)
 *   - `createBuffer` / `getChannelData` validate their arguments
 *
 * `SoundEngine` catches audio faults so a broken sound cannot take down input
 * handling — which means a real fault shows up as silence, not as a crash. The
 * engine now reports one console warning per distinct fault, so this harness
 * captures `console.warn` and attributes each warning to the sound that caused
 * it.
 *
 *   npx tsx scripts/audio-diag.ts
 */

import { sound, SOUND_NAMES } from '../src/audio/SoundEngine';
import { SCENE_IDS } from '../src/audio/scenes';

/* ------------------------------------------------------------------ */
/* Strict audio primitives                                             */
/* ------------------------------------------------------------------ */

const warnings: string[] = [];

function finite(value: number, what: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${what}: not finite (${value})`);
}

function future(value: number, what: string): void {
  finite(value, what);
  if (value < 0) throw new RangeError(`${what}: negative time (${value})`);
}

class StrictParam {
  value = 1;
  constructor(private readonly name: string) {}

  setValueAtTime(v: number, t: number): this {
    finite(v, `${this.name}.setValueAtTime`);
    future(t, `${this.name}.setValueAtTime`);
    return this;
  }

  linearRampToValueAtTime(v: number, t: number): this {
    finite(v, `${this.name}.linearRampToValueAtTime`);
    future(t, `${this.name}.linearRampToValueAtTime`);
    return this;
  }

  exponentialRampToValueAtTime(v: number, t: number): this {
    finite(v, `${this.name}.exponentialRampToValueAtTime`);
    future(t, `${this.name}.exponentialRampToValueAtTime`);
    if (v <= 0) {
      throw new RangeError(`${this.name}.exponentialRampToValueAtTime: target ${v} must be > 0`);
    }
    return this;
  }

  setTargetAtTime(v: number, t: number, tc: number): this {
    finite(v, `${this.name}.setTargetAtTime`);
    future(t, `${this.name}.setTargetAtTime`);
    if (!(tc > 0)) throw new RangeError(`${this.name}.setTargetAtTime: tc ${tc} must be > 0`);
    return this;
  }

  cancelScheduledValues(t: number): this {
    future(t, `${this.name}.cancelScheduledValues`);
    return this;
  }
}

class Node {
  connect(target: unknown): unknown {
    return target;
  }
  disconnect(): void {
    /* no-op */
  }
}

class Gain extends Node {
  gain = new StrictParam('gain');
}

class Panner extends Node {
  pan = new StrictParam('pan');
}

class Osc extends Node {
  type: OscillatorType = 'sine';
  frequency = new StrictParam('frequency');
  detune = new StrictParam('detune');
  started = false;
  setPeriodicWave(): void {
    /* accepted */
  }
  start(t = 0): void {
    future(t, 'osc.start');
    this.started = true;
  }
  stop(t = 0): void {
    future(t, 'osc.stop');
    if (!this.started) throw new Error('osc.stop() before start()');
  }
}

class Src extends Node {
  buffer: unknown = null;
  loop = false;
  playbackRate = new StrictParam('playbackRate');
  started = false;
  start(t = 0, offset = 0): void {
    future(t, 'src.start');
    future(offset, 'src.start(offset)');
    this.started = true;
  }
  stop(t = 0): void {
    future(t, 'src.stop');
    if (!this.started) throw new Error('src.stop() before start()');
  }
}

class Filter extends Node {
  type: BiquadFilterType = 'lowpass';
  frequency = new StrictParam('filter.frequency');
  Q = new StrictParam('filter.Q');
  gain = new StrictParam('filter.gain');
}

class Compressor extends Node {
  threshold = new StrictParam('comp.threshold');
  knee = new StrictParam('comp.knee');
  ratio = new StrictParam('comp.ratio');
  attack = new StrictParam('comp.attack');
  release = new StrictParam('comp.release');
  reduction = 0;
}

class Convolver extends Node {
  buffer: unknown = null;
  normalize = true;
}

/**
 * An AudioBuffer.
 *
 * Written with an explicit constructor body rather than parameter properties:
 * with `useDefineForClassFields`, field initialisers run BEFORE parameter
 * properties are assigned, so a field reading `this.length` sees `undefined`
 * and silently produces a zero-length buffer. That is exactly the trap this
 * file fell into on its first draft — a mock bug that looked like an engine bug.
 */
class Buf {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly data: Float32Array[];

  constructor(channels: number, length: number, rate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = rate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.sampleRate > 0 ? this.length / this.sampleRate : 0;
  }

  getChannelData(channel: number): Float32Array {
    const found = this.data[channel];
    if (!found) throw new RangeError(`getChannelData(${channel}) out of range`);
    return found;
  }
}

class StrictAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  destination = new Node();

  oscillators = 0;
  sources = 0;

  createGain = (): Gain => new Gain();
  createStereoPanner = (): Panner => new Panner();
  createBiquadFilter = (): Filter => new Filter();
  createDynamicsCompressor = (): Compressor => new Compressor();
  createConvolver = (): Convolver => new Convolver();

  createOscillator = (): Osc => {
    this.oscillators += 1;
    return new Osc();
  };

  createBufferSource = (): Src => {
    this.sources += 1;
    return new Src();
  };

  createPeriodicWave = (real: Float32Array, imag: Float32Array): unknown => {
    if (real.length !== imag.length) {
      throw new Error(`createPeriodicWave: length mismatch ${real.length} vs ${imag.length}`);
    }
    let energy = 0;
    for (let i = 0; i < imag.length; i += 1) energy += Math.abs(imag[i]);
    if (energy === 0) throw new Error('createPeriodicWave: all coefficients are zero');
    return { __wave: true };
  };

  createBuffer = (channels: number, length: number, rate: number): Buf => {
    if (channels < 1) throw new RangeError('createBuffer: channels must be >= 1');
    if (length < 1) throw new RangeError('createBuffer: length must be >= 1');
    if (rate <= 0) throw new RangeError('createBuffer: sampleRate must be > 0');
    return new Buf(channels, length, rate);
  };

  resume = async (): Promise<void> => {
    await Promise.resolve();
    this.state = 'running';
  };

  close = async (): Promise<void> => {
    this.state = 'closed';
  };
}

/* ------------------------------------------------------------------ */
/* Install: window + console capture                                   */
/* ------------------------------------------------------------------ */

const ctx = new StrictAudioContext();

(globalThis as unknown as { window: unknown }).window = {
  AudioContext: function AudioContextCtor() {
    return ctx;
  },
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (id: number) => clearTimeout(id),
  matchMedia: () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }),
};

/* Capture the engine's own fault reports instead of letting them scroll past. */
const realWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  warnings.push(args.map(String).join(' '));
};

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

interface Result {
  label: string;
  problems: string[];
}

const results: Result[] = [];

/** Run one subject and collect every warning it produced. */
function probe(label: string, fn: () => void): Result {
  warnings.length = 0;
  try {
    fn();
  } catch (err) {
    warnings.push(`THREW ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
  }
  const problems = [...warnings];
  results.push({ label, problems });
  return { label, problems };
}

async function main(): Promise<void> {
  console.log('\naudio diagnostic — strict WebAudio mock\n');

  /* ---- 1. unlock, as a keydown would --------------------------- */
  const unlocked = sound.unlock();
  console.log(`  unlock() -> ${unlocked}, ctx.state "${ctx.state}", sampleRate ${ctx.sampleRate}`);

  /* ---- 2. every catalogue sound -------------------------------- */
  console.log('\n  catalogue:');
  for (const name of SOUND_NAMES) {
    const before = ctx.oscillators + ctx.sources;
    const result = probe(`sound "${name}"`, () => sound.play(name));
    const built = ctx.oscillators + ctx.sources - before;

    if (result.problems.length === 0 && built > 0) {
      console.log(`    ok    ${name}  (${built} nodes)`);
    } else if (result.problems.length === 0) {
      console.log(`    FAIL  ${name}  (built nothing)`);
    } else {
      console.log(`    FAIL  ${name}  — ${result.problems.join('; ')}`);
    }
  }

  /* ---- 3. the modem -------------------------------------------- */
  console.log('\n  modem:');
  for (let run = 1; run <= 3; run += 1) {
    let duration = 0;
    const result = probe(`handshake ${run}`, () => {
      const handle = sound.handshake();
      duration = handle.duration;
      handle();
    });

    if (result.problems.length === 0 && duration > 0) {
      console.log(`    ok    run ${run}: ${duration}s`);
    } else {
      const why = result.problems.length
        ? result.problems.join('; ')
        : 'returned a zero-duration no-op';
      console.log(`    FAIL  run ${run}: ${why}`);
    }
  }

  /* ---- 4. every ambience scene --------------------------------- */
  console.log('\n  ambience:');
  probe('room tone start', () => sound.setAmbienceEnabled(true));
  for (const scene of SCENE_IDS) {
    const result = probe(`scene "${scene}"`, () => sound.setAmbienceScene(scene));
    console.log(
      result.problems.length === 0
        ? `    ok    ${scene}`
        : `    FAIL  ${scene}  — ${result.problems.join('; ')}`,
    );
  }

  /* ---- 5. mute / unmute --------------------------------------- */
  console.log('\n  lifecycle:');
  for (const [label, fn] of [
    ['mute', () => sound.setEnabled(false)],
    ['unmute', () => sound.setEnabled(true)],
    ['play after unmute', () => sound.play('hit')],
    ['location -> forest', () => sound.setLocation('forest')],
    ['location -> dragon', () => sound.setLocation('dragon')],
    ['volume change', () => sound.setVolume(0.55)],
  ] as Array<[string, () => void]>) {
    const result = probe(label, fn);
    console.log(
      result.problems.length === 0 ? `    ok    ${label}` : `    FAIL  ${label}  — ${result.problems.join('; ')}`,
    );
  }

  /* ---- report ------------------------------------------------- */
  /* The engine dedupes by fault, so the first probe of a kind owns the warning.
     That is fine: it names the first sound that hit it. */
  const broken = results.filter((r) => r.problems.length > 0);

  console.warn = realWarn;

  if (broken.length === 0) {
    console.log('\n  every sound, the modem, and every scene render against a strict mock.\n');
    process.exit(0);
  }

  console.log(`\n  ${broken.length} subject(s) raised a fault:\n`);
  for (const r of broken) {
    console.log(`    ${r.label}`);
    for (const p of r.problems) console.log(`        ${p}`);
  }
  console.log('');
  process.exit(1);
}

void main();
