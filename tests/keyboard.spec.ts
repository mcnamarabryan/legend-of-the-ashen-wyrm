import { describe, expect, it, vi } from 'vitest';

/**
 * THE KEYBOARD.
 *
 * The keyclick is the most-heard sound in the game — a player will hear it
 * tens of thousands of times — so it gets its own suite. These tests pin the
 * properties that make a keyswitch read as *mechanical* rather than as a beep,
 * and they are the properties a well-meaning simplification would quietly remove:
 *
 *  1. **Four distinct events.** Press, bottom-out, plate ring, release. A single
 *     click is a mouse.
 *  2. **A low body.** The bottom-out has to be low enough to be a *mass* hitting
 *     a plate, not just another click.
 *  3. **A case resonance.** The thing most imitations omit, and the only layer
 *     that gives the keyboard a body rather than an edge.
 *  4. **A jittered release.** The gap between press and release is how long the
 *     key was held. Fixed gap = drum machine.
 *  5. **Three axes of variation.** Pitch, velocity, and alternate physical stacks,
 *     so consecutive keys are different *objects*, not just detuned copies.
 *  6. **No stacking under key repeat.** Holding a key must roll, not buzz.
 */

class FakeParam {
  value = 0;
  setValueAtTime = vi.fn((v: number) => scheduled.push(v));
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  setTargetAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}

/** Frequencies scheduled, across the whole fake context. */
let scheduled: number[] = [];

class FakeNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakePanner extends FakeNode {
  pan = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  detune = new FakeParam();
  start = vi.fn();
  stop = vi.fn();
  setPeriodicWave = vi.fn();
}

class FakeBufferSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  start = vi.fn();
  stop = vi.fn();
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
}

class FakeCompressor extends FakeNode {
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
}

class FakeCtx {
  state = 'running' as const;
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();

  oscillators = 0;
  bufferSources = 0;
  gains: FakeGain[] = [];

  createGain = () => {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  };
  createOscillator = () => {
    this.oscillators += 1;
    return new FakeOscillator();
  };
  createBufferSource = () => {
    this.bufferSources += 1;
    return new FakeBufferSource();
  };
  createBiquadFilter = () => new FakeFilter();
  createStereoPanner = () => new FakePanner();
  createDynamicsCompressor = () => new FakeCompressor();
  createPeriodicWave = (real: Float32Array, imag: Float32Array) => ({ real, imag });
  createBuffer = (channels: number, length: number) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      numberOfChannels: channels,
      length,
      sampleRate: this.sampleRate,
      duration: length / this.sampleRate,
      getChannelData: (i: number) => data[i],
    };
  };
}

/* ------------------------------------------------------------------ */
/* The design, as data                                                */
/* ------------------------------------------------------------------ */

describe('the keyboard — design', () => {
  it('is a four-event mechanism, not a click', async () => {
    const { KEY } = await import('../src/audio/keyboard');

    /*
     * Press, bottom-out, plate ring, release. If this ever drops to two voices,
     * something has decided the case does not matter — and that is the single
     * change that turns a keyboard into a mouse.
     */
    expect(KEY.voices.length).toBeGreaterThanOrEqual(5);
  });

  it('has a bottom-out low enough to be a mass, not a click', async () => {
    const { KEY } = await import('../src/audio/keyboard');

    const lowest = Math.min(...KEY.voices.filter((v) => v.freq > 0).map((v) => v.freq));

    /* A cap hitting a plate is below ~200 Hz. Above that it is a tick. */
    expect(lowest).toBeLessThan(200);
  });

  it('has a plate ring — the layer that gives it a case', async () => {
    const { KEY } = await import('../src/audio/keyboard');

    /*
     * A pitched partial that outlives the transient. This is what separates a
     * keyboard from a series of clicks, and it is the layer most often omitted.
     */
    const ring = KEY.voices.filter((v) => v.freq >= 400 && v.freq <= 900 && v.dur >= 0.05);
    expect(ring.length).toBeGreaterThan(0);
  });

  it('jitters the release in time so the hold length varies', async () => {
    const { KEY } = await import('../src/audio/keyboard');

    /*
     * THE MOST IMPORTANT PROPERTY IN THE DESIGN.
     *
     * A fixed press-release gap is mechanically identical on every keystroke.
     * `atJitter` on the late voices is what makes it sound played.
     */
    const late = KEY.voices.filter((v) => v.at > 0.02);
    expect(late.length).toBeGreaterThan(0);
    expect(late.every((v) => (v.atJitter ?? 0) > 0)).toBe(true);
  });

  it('varies on three independent axes', async () => {
    const { KEY } = await import('../src/audio/keyboard');

    /* Pitch. */
    expect(KEY.jitter).toBeGreaterThan(0);
    /* Velocity. */
    expect(KEY.gainJitter).toBeGreaterThan(0);
    /* Physical character — alternate caps. */
    expect(KEY.variants?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('offers physically different alternates, not detuned copies', async () => {
    const { KEY } = await import('../src/audio/keyboard');

    const stacks = [KEY.voices, ...(KEY.variants ?? [])].filter((s) => s.length > 0);
    expect(stacks.length).toBeGreaterThanOrEqual(3);

    /* Each alternate must have its own plate-ring frequency, or it is not a
       different cap — it is the same cap at a different pitch. */
    const rings = stacks.map((s) => {
      const ring = s.find((v) => v.freq >= 400 && v.freq <= 900 && v.dur >= 0.05);
      return ring?.freq ?? 0;
    });
    expect(new Set(rings).size).toBe(rings.length);
  });

  it('stays well under the combat sounds in level', async () => {
    const { KEY } = await import('../src/audio/keyboard');
    const { DESIGNS } = await import('../src/audio/catalogue');

    const peakOf = (voices: { gain: number }[]) => Math.max(...voices.map((v) => v.gain));

    /* A keyboard you cannot type through for an hour is a keyboard nobody uses. */
    expect(peakOf(KEY.voices)).toBeLessThan(peakOf(DESIGNS.hit.voices));
    expect(peakOf(KEY.voices)).toBeLessThan(peakOf(DESIGNS.crit.voices));
  });

  it('never sums past the bus budget', async () => {
    const { KEY } = await import('../src/audio/keyboard');

    const stacks = [KEY.voices, ...(KEY.variants ?? [])].filter((s) => s.length > 0);
    for (const stack of stacks) {
      const total = stack.reduce((sum, v) => sum + v.gain, 0) * (KEY.trim ?? 1);
      /* Above ~0.45 the master compressor starts working on ordinary typing. */
      expect(total).toBeLessThan(0.45);
    }
  });

  it('is throttled so key repeat rolls rather than buzzes', async () => {
    const { KEY } = await import('../src/audio/keyboard');

    expect(KEY.throttleMs).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Rendering                                                          */
/* ------------------------------------------------------------------ */

describe('the keyboard — rendering', () => {
  async function engine() {
    vi.resetModules();
    return import('../src/audio/SoundEngine');
  }

  function install() {
    const ctx = new FakeCtx();
    vi.stubGlobal('window', {
      ...globalThis,
      AudioContext: function () {
        return ctx;
      },
    });
    return ctx;
  }

  it('builds every layer of the stack, not one', async () => {
    const ctx = install();
    const { sound } = await engine();

    sound.setAmbienceEnabled(false);
    sound.unlock();

    const before = ctx.oscillators + ctx.bufferSources;
    sound.play('key');
    const built = ctx.oscillators + ctx.bufferSources - before;

    /*
     * Five voices minimum: one noise transient, one switch tone, one bottom-out,
     * one cap body, one plate ring, plus release voices. A single-voice key would
     * be 2 (one osc + one noise); anything mechanical is far more.
     */
    expect(built).toBeGreaterThanOrEqual(5);
  });

  it('picks different stacks across repeats', async () => {
    const ctx = install();
    const { sound } = await engine();

    sound.setAmbienceEnabled(false);
    sound.unlock();

    /*
     * Three alternate stacks means the node count per keystroke differs. We can
     * see that by sampling how many sources each press builds — if every press
     * built the same number, only one stack would ever be chosen.
     */
    const counts: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const before = ctx.oscillators + ctx.bufferSources;
      sound.play('key');
      counts.push(ctx.oscillators + ctx.bufferSources - before);
    }

    /* At least two distinct shapes must have been played. */
    expect(new Set(counts).size).toBeGreaterThan(1);
  });

  it('schedules varied frequencies across repeats', async () => {
    /* No `ctx` binding here: this test observes scheduling, not node counts. */
    install();
    const { sound } = await engine();

    sound.setAmbienceEnabled(false);
    sound.unlock();

    scheduled = [];
    for (let i = 0; i < 25; i += 1) sound.play('key');

    const distinct = new Set(scheduled.map((f) => Math.round(f)));
    /* Pitch jitter plus alternate stacks means many distinct pitches. */
    expect(distinct.size).toBeGreaterThan(3);
  });

  it('is silent when disabled', async () => {
    const ctx = install();
    const { sound } = await engine();

    /* Build the context first so a counter exists to compare against. */
    sound.setAmbienceEnabled(false);
    sound.unlock();

    sound.setEnabled(false);
    const before = ctx.oscillators + ctx.bufferSources;
    sound.play('key');
    expect(ctx.oscillators + ctx.bufferSources).toBe(before);
  });

  it('tolerates a context without a stereo panner', async () => {
    const ctx = install();
    /* Strip the panner: the keyboard must still play, just mono. */
    (ctx as unknown as { createStereoPanner?: unknown }).createStereoPanner = undefined;

    const { sound } = await engine();
    sound.setAmbienceEnabled(false);
    sound.unlock();

    const before = ctx.oscillators;
    expect(() => sound.play('key')).not.toThrow();
    /* And it must still have built the stack. */
    expect(ctx.oscillators).toBeGreaterThan(before);
  });
});
