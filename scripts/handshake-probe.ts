/**
 * Probe: why does the modem handshake return a zero-duration no-op?
 *
 * `SoundEngine.handshake()` wraps `scheduleHandshake()` in a bare catch and
 * returns a silent no-op on failure. That is deliberate — a broken modem must
 * not take down the boot screen — but it means the real error is invisible.
 * This calls the scheduler directly so the exception is printed.
 *
 *   npx tsx scripts/handshake-probe.ts
 */

import { scheduleHandshake } from '../src/audio/handshake';

/* Minimal but strict: only what a browser would refuse is refused. */
class P {
  value = 1;
  constructor(private n: string) {}
  setValueAtTime(v: number, t: number): this {
    if (!Number.isFinite(v) || !Number.isFinite(t)) {
      throw new TypeError(`${this.n}.setValueAtTime(${v}, ${t})`);
    }
    if (t < 0) throw new RangeError(`${this.n}.setValueAtTime: negative ${t}`);
    return this;
  }
  linearRampToValueAtTime(_v: number, t: number): this {
    if (t < 0) throw new RangeError(`${this.n}.linearRamp: negative ${t}`);
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    if (!Number.isFinite(v) || !Number.isFinite(t)) {
      throw new TypeError(`${this.n}.expRamp(${v}, ${t})`);
    }
    if (v <= 0) throw new RangeError(`${this.n}.expRamp: target ${v} must be > 0`);
    if (t < 0) throw new RangeError(`${this.n}.expRamp: negative ${t}`);
    return this;
  }
  setTargetAtTime(_v: number, _t: number, tc: number): this {
    if (!(tc > 0)) throw new RangeError(`${this.n}.setTarget: tc ${tc}`);
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

class N {
  connect(o: unknown): unknown {
    return o;
  }
  disconnect(): void {}
}

class G extends N {
  gain = new P('gain');
}
class Osc extends N {
  type: OscillatorType = 'sine';
  frequency = new P('osc.frequency');
  detune = new P('osc.detune');
  private started = false;
  setPeriodicWave(): void {}
  start(t = 0): void {
    if (t < 0) throw new RangeError('osc.start negative');
    this.started = true;
  }
  stop(t = 0): void {
    if (!this.started) throw new Error('osc.stop before start');
    if (t < 0) throw new RangeError('osc.stop negative');
  }
}
class Src extends N {
  buffer: unknown = null;
  loop = false;
  private started = false;
  start(t = 0, off = 0): void {
    if (t < 0 || off < 0) throw new RangeError(`src.start(${t}, ${off})`);
    this.started = true;
  }
  stop(t = 0): void {
    if (!this.started) throw new Error('src.stop before start');
    if (t < 0) throw new RangeError(`src.stop(${t})`);
  }
}
class F extends N {
  type: BiquadFilterType = 'bandpass';
  frequency = new P('filter.frequency');
  Q = new P('filter.Q');
  gain = new P('filter.gain');
}
class Panner extends N {
  pan = new P('pan');
}
class Ctx {
  currentTime = 0;
  sampleRate = 48000;
  destination = new N();
  createGain = () => new G();
  createOscillator = () => new Osc();
  createBufferSource = () => new Src();
  createBiquadFilter = () => new F();
  createStereoPanner = () => new Panner();
  createPeriodicWave = (real: Float32Array, imag: Float32Array) => {
    if (real.length !== imag.length) throw new Error('periodic wave length mismatch');
    return {};
  };
  createBuffer = (ch: number, len: number, rate: number) => ({
    numberOfChannels: ch,
    length: len,
    sampleRate: rate,
    duration: len / rate,
    getChannelData: () => new Float32Array(len),
  });
}

globalThis.window = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (id: number) => clearTimeout(id),
} as never;

const ctx = new Ctx();

try {
  const handle = scheduleHandshake(ctx as never, ctx.destination as never, 0.02);
  console.log(`handshake scheduled, duration ${handle.duration}s`);
  handle.cancel();
  process.exit(0);
} catch (err) {
  console.error('\nhandshake THREW:');
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  if (err instanceof Error && err.stack) {
    console.error('\n', err.stack.split('\n').slice(1, 5).join('\n'));
  }
  process.exit(1);
}
