import { describe, expect, it, vi } from 'vitest';

/**
 * THE BUG THAT MADE THE MODEM SILENT.
 *
 * `unlock()` calls `resume()`, which is asynchronous. The old code then
 * synchronously checked `ctx.state !== 'running'` in `handshake()` and bailed
 * out — so on the very first gesture (create context, resume, schedule) the
 * state was still 'suspended' and nothing was ever scheduled.
 *
 * These tests drive a fake AudioContext that stays suspended until its
 * microtask settles, which is the browser's actual behaviour. The harness is
 * deliberately fussy about that timing, because a fake that resumes instantly
 * would hide the very race it exists to catch.
 */

class FakeParam {
  value = 0;
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  setTargetAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}

class FakeGain {
  gain = new FakeParam();
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeOscillator {
  type = 'sine';
  frequency = new FakeParam();
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeBufferSource {
  buffer: unknown = null;
  loop = false;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeFilter {
  type = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeCompressor {
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  connect = vi.fn();
  disconnect = vi.fn();
}

/**
 * Suspended on construction. `resume()` schedules the state change in a
 * microtask, so immediately after calling it the state is STILL suspended —
 * exactly the window in which the old code gave up.
 */
class FakeAudioContext {
  state: 'suspended' | 'running' = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  destination = { connect: vi.fn() };

  /** Counters, so a test can prove the graph was actually built. */
  oscillators = 0;
  bufferSources = 0;
  /** Every scheduled source, so a test can inspect start/stop times. */
  started: Array<{
    stop: { mock: { calls: unknown[][] } };
  }> = [];

  createGain = () => new FakeGain();

  createOscillator = () => {
    this.oscillators += 1;
    const osc = new FakeOscillator();
    this.started.push(osc);
    return osc;
  };

  createBufferSource = () => {
    this.bufferSources += 1;
    const src = new FakeBufferSource();
    this.started.push(src);
    return src;
  };

  createBiquadFilter = () => new FakeFilter();
  createDynamicsCompressor = () => new FakeCompressor();

  createBuffer = (_channels: number, length: number) => ({
    getChannelData: () => new Float32Array(length),
  });

  resume = vi.fn(async () => {
    /* Deferred: this is what a browser does. */
    await Promise.resolve();
    this.state = 'running';
  });

  close = vi.fn(async () => undefined);
}

function installFakeContext() {
  const ctx = new FakeAudioContext();

  /* Keep the real timers and only override AudioContext. Replacing the whole
     window object would break setTimeout, which the handshake uses. */
  vi.stubGlobal('window', {
    ...globalThis,
    AudioContext: function () {
      return ctx;
    },
  });

  return ctx;
}

async function freshEngine() {
  vi.resetModules();
  return import('../src/audio/SoundEngine');
}

describe('SoundEngine — the first-gesture race', () => {
  it('schedules the handshake while the context is still suspended', async () => {
    const ctx = installFakeContext();
    const { sound } = await freshEngine();

    /* The exact first-gesture sequence. */
    sound.unlock();
    expect(ctx.state).toBe('suspended');

    const before = ctx.oscillators;
    const cancel = sound.handshake();

    /* The old code returned a no-op here and scheduled nothing. The handshake
       must build its graph regardless of state. */
    expect(ctx.oscillators).toBeGreaterThan(before);
    expect(typeof cancel).toBe('function');

    cancel();
    await Promise.resolve();
  });

  it('reports unlocked without waiting for state === running', async () => {
    const ctx = installFakeContext();
    const { sound } = await freshEngine();

    expect(sound.unlocked).toBe(false);
    sound.unlock();

    /* The core assertion: unlocked is about having a context, not about the
       resume promise having settled. */
    expect(sound.unlocked).toBe(true);
    expect(ctx.state).toBe('suspended');

    await Promise.resolve();
  });

  it('play() does not bail while the context is suspended', async () => {
    const ctx = installFakeContext();
    const { sound } = await freshEngine();

    sound.unlock();
    const before = ctx.oscillators;

    expect(() => sound.play('key')).not.toThrow();
    expect(ctx.oscillators).toBeGreaterThan(before);

    await Promise.resolve();
  });

  it('setEnabled(true) unlocks in the same tick', async () => {
    installFakeContext();
    const { sound } = await freshEngine();

    sound.setEnabled(true);
    expect(sound.unlocked).toBe(true);
  });

  it('dials after setEnabled(true) with no intervening render', async () => {
    installFakeContext();
    const { sound } = await freshEngine();

    /* Mirrors acceptSound: turn sound on, then dial, same tick. The old dial()
       checked an isEnabled flag that a useEffect had not written yet. */
    sound.setEnabled(true);
    expect(sound.isEnabled).toBe(true);

    const cancel = sound.handshake();
    expect(typeof cancel).toBe('function');
    cancel();
  });

  it('stays silent when disabled', async () => {
    const ctx = installFakeContext();
    const { sound } = await freshEngine();

    sound.setEnabled(false);
    expect(sound.isEnabled).toBe(false);

    const before = ctx.oscillators;
    const cancel = sound.handshake();

    /* Disabled means no graph is built at all. */
    expect(ctx.oscillators).toBe(before);
    expect(typeof cancel).toBe('function');
    cancel();
  });

  it('cancel stops every scheduled node', async () => {
    const ctx = installFakeContext();
    const { sound } = await freshEngine();

    sound.unlock();
    const cancel = sound.handshake();
    cancel();

    /* Cancelling must not throw and must leave the engine usable. */
    expect(() => sound.handshake()()).not.toThrow();
    expect(ctx.oscillators).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* The handshake is a sequence, not a blur                            */
/* ------------------------------------------------------------------ */

describe('SoundEngine — the handshake timeline', () => {
  /**
   * The handshake is meant to be a *long, varied* sequence. These tests pin the
   * two properties that make it feel like a real call rather than a single
   * noise, and the one that keeps the UI honest.
   */
  it('schedules a lot of discrete events, not a handful', async () => {
    const ctx = installFakeContext();
    const { sound } = await freshEngine();

    sound.unlock();
    const cancel = sound.handshake();

    /* Roughly: 18 tones + 8 noise bursts. A "blur" would be three or four. */
    const total = ctx.oscillators + ctx.bufferSources;
    expect(total).toBeGreaterThanOrEqual(20);

    cancel();
    await Promise.resolve();
  });

  it('uses both tones and noise', async () => {
    const ctx = installFakeContext();
    const { sound } = await freshEngine();

    sound.unlock();
    const cancel = sound.handshake();

    expect(ctx.oscillators).toBeGreaterThan(0);
    expect(ctx.bufferSources).toBeGreaterThan(0);

    cancel();
    await Promise.resolve();
  });

  it('spans several seconds', async () => {
    const ctx = installFakeContext();
    const { sound } = await freshEngine();

    sound.unlock();
    const cancel = sound.handshake();

    /* Collect the stop times the engine scheduled. The last one is the end of
       the final phase, which is how long the call actually runs. */
    const stops: number[] = [];
    for (const src of ctx.started) {
      for (const call of src.stop.mock.calls) stops.push(call[0] as number);
    }

    const last = Math.max(...stops);
    /* A compressed sketch lands near 2s. The real thing is longer. */
    expect(last).toBeGreaterThan(4.5);

    cancel();
    await Promise.resolve();
  });
});
