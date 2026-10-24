import { describe, expect, it, vi } from 'vitest';

/**
 * THE AUDIO SUITE.
 *
 * Two jobs:
 *
 *  1. **Guard the first-gesture race.** `unlock()` calls `resume()`, which is
 *     asynchronous. An earlier version scheduled nothing when the context was
 *     still 'suspended', so the modem worked on the second keypress and never
 *     the first. The fake context below deliberately stays suspended until its
 *     microtask settles, because a fake that resumes instantly would hide the
 *     very race these tests exist to catch.
 *
 *  2. **Guard the sound design.** A design is data, so it can be asserted on
 *     without an AudioContext. These tests pin the properties that make the
 *     catalogue good rather than merely different: every sound is layered,
 *     nothing clips, nothing is silent, and the percussive/release envelopes
 *     are actually applied.
 */

class FakeParam {
  value = 0;
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  setTargetAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}

class FakeNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  detune = new FakeParam();
  setPeriodicWave = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeBufferSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  playbackRate = new FakeParam();
  start = vi.fn();
  stop = vi.fn();
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
  gain = new FakeParam();
}

class FakePanner extends FakeNode {
  pan = new FakeParam();
}

class FakeCompressor extends FakeNode {
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  reduction = 0;
}

class FakeConvolver extends FakeNode {
  buffer: unknown = null;
  normalize = true;
}

/**
 * Suspended on construction. `resume()` flips the state in a microtask, so
 * immediately after calling it the state is STILL 'suspended' — exactly the
 * window in which the old code gave up.
 */
class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();

  oscillators = 0;
  bufferSources = 0;
  /** Every scheduled source, so a test can inspect start/stop times. */
  started: Array<{ start: { mock: { calls: unknown[][] } }; stop: { mock: { calls: unknown[][] } } }> =
    [];

  createGain = () => new FakeGain();

  createOscillator = () => {
    this.oscillators += 1;
    const osc = new FakeOscillator();
    this.started.push(osc as never);
    return osc;
  };

  createBufferSource = () => {
    this.bufferSources += 1;
    const src = new FakeBufferSource();
    this.started.push(src as never);
    return src;
  };

  createBiquadFilter = () => new FakeFilter();
  createDynamicsCompressor = () => new FakeCompressor();
  createStereoPanner = () => new FakePanner();
  createConvolver = () => new FakeConvolver();

  /** Band-limited waves. A real implementation, so the renderer's happy path runs. */
  createPeriodicWave = (real: Float32Array, imag: Float32Array) => ({
    real,
    imag,
    __wave: true,
  });

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

  resume = vi.fn(async () => {
    /* Deferred: this is what a browser does. */
    await Promise.resolve();
    this.state = 'running';
  });

  close = vi.fn(async () => {
    this.state = 'closed';
  });
}

function installFakeContext() {
  const ctx = new FakeAudioContext();

  /* Keep real timers; only override AudioContext. Replacing the whole window
     would break setTimeout, which the handshake uses. */
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

/* ------------------------------------------------------------------ */
/* The first-gesture race                                             */
/* ------------------------------------------------------------------ */

describe('SoundEngine — the first-gesture race', () => {
  it('schedules the handshake while the context is still suspended', async () => {
    const ctx = installFakeContext();
    const { sound } = await freshEngine();

    sound.unlock();
    expect(ctx.state).toBe('suspended');

    const before = ctx.oscillators;
    const cancel = sound.handshake();

    /* The old code returned a no-op here and scheduled nothing. */
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

    /* `unlocked` means "we have a context", not "resume has settled". */
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

    /* Mirrors acceptSound: turn sound on, then dial, same tick. */
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
    const before = ctx.oscillators;
    const cancel = sound.handshake();

    expect(ctx.oscillators).toBe(before);
    expect(typeof cancel).toBe('function');
    cancel();
  });

  it('cancel stops every scheduled node and stays reusable', async () => {
    const ctx = installFakeContext();
    const { sound } = await freshEngine();

    sound.unlock();
    sound.handshake()();

    /* `stop` is called on every scheduled source by cancel. A source that was
       never started must not throw, which is why the cancel path is wrapped. */
    expect(() => sound.handshake()()).not.toThrow();
    expect(ctx.oscillators).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* The handshake timeline                                             */
/* ------------------------------------------------------------------ */

describe('SoundEngine — the handshake timeline', () => {
  it('schedules a lot of discrete events, not a handful', async () => {
    const ctx = installFakeContext();
    const { sound } = await freshEngine();

    sound.unlock();
    const cancel = sound.handshake();

    /* Roughly 50 tones plus a dozen noise bursts. A "blur" would be three. */
    const total = ctx.oscillators + ctx.bufferSources;
    expect(total).toBeGreaterThanOrEqual(40);

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

  it('reports a duration the UI can wait on', async () => {
    installFakeContext();
    const { sound } = await freshEngine();

    sound.unlock();
    const handle = sound.handshake();

    /*
     * The shell used to hold its own `HANDSHAKE_MS` constant that had to be kept
     * in sync by hand. If this test fails, the boot screen would claim the
     * carrier was up at the wrong moment.
     */
    expect(handle.duration).toBeGreaterThan(5);
    expect(handle.duration).toBeLessThan(9);

    handle();
  });

  it('spans several seconds', async () => {
    const ctx = installFakeContext();
    const { sound } = await freshEngine();

    sound.unlock();
    const cancel = sound.handshake();

    const stops: number[] = [];
    for (const src of ctx.started) {
      for (const call of src.stop.mock.calls) stops.push(call[0] as number);
    }

    const last = Math.max(...stops);
    expect(last).toBeGreaterThan(5);

    cancel();
    await Promise.resolve();
  });
});

/* ------------------------------------------------------------------ */
/* The catalogue, asserted as data                                    */
/* ------------------------------------------------------------------ */

describe('the sound catalogue', () => {
  it('defines every declared sound', async () => {
    vi.resetModules();
    const { DESIGNS, SOUND_NAMES } = await import('../src/audio/catalogue');

    expect(SOUND_NAMES.length).toBeGreaterThanOrEqual(17);
    for (const name of SOUND_NAMES) {
      const design = DESIGNS[name];
      expect(design, `${name} has no design`).toBeDefined();
      expect(design.voices.length, `${name} is a single bare oscillator`).toBeGreaterThan(0);
    }
  });

  it('never lets a sound clip the bus', async () => {
    const { DESIGNS, SOUND_NAMES } = await import('../src/audio/catalogue');

    /*
     * Sum the peak gains of every voice in a design. Above ~0.45 and the master
     * compressor starts working on ordinary play, which sounds squashed. This is
     * the budget the designs are written to and the thing that keeps the mix
     * from sounding cheap.
     */
    for (const name of SOUND_NAMES) {
      const design = DESIGNS[name];
      const trim = design.trim ?? 1;
      const total = design.voices.reduce((sum, v) => sum + v.gain * trim, 0);
      expect(total, `${name} sums to ${total.toFixed(3)}`).toBeLessThan(0.45);
    }
  });

  it('is audibly loud enough to hear', async () => {
    const { DESIGNS, SOUND_NAMES } = await import('../src/audio/catalogue');

    for (const name of SOUND_NAMES) {
      const design = DESIGNS[name];
      const trim = design.trim ?? 1;
      const loudest = Math.max(...design.voices.map((v) => v.gain * trim));
      expect(loudest, `${name} is inaudible`).toBeGreaterThan(0.01);
    }
  });

  it('layers the important sounds rather than leaving them thin', async () => {
    const { DESIGNS } = await import('../src/audio/catalogue');

    /* Combat needs a body, a transient and weight. One layer cannot do all
       three, and a single-oscillator hit is the classic cheap-game sound. */
    expect(DESIGNS.hit.voices.length).toBeGreaterThanOrEqual(3);
    expect(DESIGNS.crit.voices.length).toBeGreaterThanOrEqual(3);
    expect(DESIGNS.hurt.voices.length).toBeGreaterThanOrEqual(2);
    expect(DESIGNS.level.voices.length).toBeGreaterThanOrEqual(5);
    expect(DESIGNS.wyrm.voices.length).toBeGreaterThanOrEqual(3);
  });

  it('gives impacts a percussive envelope and pads a sustaining one', async () => {
    const { DESIGNS } = await import('../src/audio/catalogue');

    /* A hit must decay, not swell. The default shape is percussive; the level-up
       chord underneath the last note is the one deliberate sustain. */
    const sustains = DESIGNS.level.voices.filter((v) => v.shape === 'sustain');
    expect(sustains.length).toBeGreaterThan(0);

    for (const voice of DESIGNS.hit.voices) {
      expect(voice.shape ?? 'percussive').toBe('percussive');
    }
  });

  it('sends the atmospheric sounds to the room and keeps keys dry', async () => {
    const { DESIGNS } = await import('../src/audio/catalogue');

    const send = (name: keyof typeof DESIGNS) =>
      Math.max(...DESIGNS[name].voices.map((v) => v.send ?? 0));

    /* A keyclick in a cathedral is wrong; a death rattle in a vacuum is worse. */
    expect(send('key')).toBe(0);
    expect(send('death')).toBeGreaterThan(0.1);
    expect(send('wyrm')).toBeGreaterThan(0.1);
  });

  it('jitters repeats so nothing is bit-identical', async () => {
    const { DESIGNS } = await import('../src/audio/catalogue');

    expect(DESIGNS.hit.jitter).toBeGreaterThan(0);
    expect(DESIGNS.crit.jitter).toBeGreaterThan(0);
    expect(DESIGNS.miss.jitter).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Rendering                                                          */
/* ------------------------------------------------------------------ */

describe('the renderer', () => {
  it('applies a band-limited wave rather than a raw oscillator type', async () => {
    vi.resetModules();
    const ctx = new FakeAudioContext();
    const { buildBus, renderSound } = await import('../src/audio/render');
    const { DESIGNS } = await import('../src/audio/catalogue');

    const bus = buildBus(ctx as never, ctx.destination as never);

    let periodicCalls = 0;
    const original = ctx.createOscillator;
    ctx.createOscillator = () => {
      const osc = original();
      osc.setPeriodicWave = vi.fn(() => {
        periodicCalls += 1;
      });
      return osc;
    };

    renderSound(bus, DESIGNS.hit, 0);

    /* Aliasing is the difference between "1989 hardware" and "cheap beep". */
    expect(periodicCalls).toBeGreaterThan(0);
  });

  it('routes reverb sends to the wet bus when asked', async () => {
    const ctx = new FakeAudioContext();
    const { buildBus, renderSound } = await import('../src/audio/render');
    const { DESIGNS } = await import('../src/audio/catalogue');

    /*
     * Observe the graph rather than guess at it: record what every gain the
     * renderer creates gets connected to. Then assert that something genuinely
     * feeds the reverb bus.
     */
    const gainSpies: Array<{ connect: { mock: { calls: unknown[][] } } }> = [];
    const originalCreateGain = ctx.createGain;
    ctx.createGain = () => {
      const gain = originalCreateGain();
      gainSpies.push(gain as never);
      return gain;
    };

    const bus = buildBus(ctx as never, ctx.destination as never);

    gainSpies.length = 0;
    renderSound(bus, DESIGNS.death, 0);

    const feedsReverb = gainSpies.some((gain) =>
      gain.connect.mock.calls.some((call) => call[0] === bus.reverb),
    );

    /* `death` carries a heavy send; it must actually reach the room. */
    expect(feedsReverb).toBe(true);
  });

  it('keeps a dry sound out of the room', async () => {
    const ctx = new FakeAudioContext();
    const { buildBus, renderSound } = await import('../src/audio/render');
    const { DESIGNS } = await import('../src/audio/catalogue');

    const gainSpies: Array<{ connect: { mock: { calls: unknown[][] } } }> = [];
    const originalCreateGain = ctx.createGain;
    ctx.createGain = () => {
      const gain = originalCreateGain();
      gainSpies.push(gain as never);
      return gain;
    };

    const bus = buildBus(ctx as never, ctx.destination as never);

    gainSpies.length = 0;
    /* The keyclick is deliberately bone dry. A keyboard in a cathedral is
       wrong, and this is the assertion that keeps it that way. */
    renderSound(bus, DESIGNS.key, 0);

    const feedsReverb = gainSpies.some((gain) =>
      gain.connect.mock.calls.some((call) => call[0] === bus.reverb),
    );

    expect(feedsReverb).toBe(false);
  });

  it('is silent when disabled', async () => {
    const ctx = installFakeContext();
    const { sound } = await freshEngine();

    sound.setEnabled(false);
    const before = ctx.oscillators;
    sound.play('hit');

    expect(ctx.oscillators).toBe(before);
  });

  it('throttles keypress mashing into a keyboard rather than a buzz', async () => {
    const ctx = installFakeContext();
    const { sound } = await freshEngine();

    sound.unlock();
    const afterUnlock = ctx.oscillators;

    /*
     * Play a burst as fast as the loop can. With an 18ms throttle and a loop
     * that runs far faster than that, most of these must be dropped.
     */
    for (let i = 0; i < 40; i += 1) sound.play('key');

    const rendered = ctx.oscillators - afterUnlock;
    /* Each key is two voices. Forty unthrottled presses would be eighty nodes. */
    expect(rendered).toBeLessThan(40);
  });
});

/* ------------------------------------------------------------------ */
/* Volume                                                             */
/* ------------------------------------------------------------------ */

describe('volume', () => {
  it('quantises to perceptual steps', async () => {
    vi.resetModules();
    const { quantiseVolume } = await import('../src/audio/Voice');

    expect(quantiseVolume(0)).toBe(0.3);
    expect(quantiseVolume(0.31)).toBe(0.3);
    expect(quantiseVolume(0.5)).toBe(0.55);
    expect(quantiseVolume(0.79)).toBe(0.8);
    expect(quantiseVolume(1)).toBe(1);
  });

  it('clamps out-of-range input', async () => {
    vi.resetModules();
    const { quantiseVolume } = await import('../src/audio/Voice');

    expect(quantiseVolume(-5)).toBe(0.3);
    expect(quantiseVolume(50)).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Cues                                                               */
/* ------------------------------------------------------------------ */

describe('cue scoring', () => {
  /**
   * A minimal ClientLine. The real one carries an `id` for the typewriter, so
   * the tests have to supply one — the id is irrelevant to scoring, but leaving
   * it off is a type error, which is exactly how it should be.
   */
  const line = (
    id: number,
    text: string,
    tone?: 'normal' | 'bright' | 'dim' | 'red' | 'gold',
  ) => ({ id, text, ...(tone ? { tone } : {}) });

  it('scores a critical as a critical, not a generic hit', async () => {
    vi.resetModules();
    const { soundForLine } = await import('../src/audio/cues');

    /*
     * The crit line contains the word "damage" as well, so rule order matters.
     * If the generic damage rule came first every crit would sound ordinary.
     */
    expect(soundForLine(line(1, '{bright}A critical blow!{/} 42 damage.'))).toBe('crit');
  });

  it('does not fire the death cue on a bank loss', async () => {
    const { soundForLine } = await import('../src/audio/cues');

    /* "You have lost 40 gold" is a shop sale, not a death. */
    expect(soundForLine(line(1, '{dim}You have lost 40 gold.{/}'))).not.toBe('death');
  });

  it('stays silent for ordinary prose', async () => {
    const { soundForLine } = await import('../src/audio/cues');

    expect(
      soundForLine(line(1, 'The square is quiet. A dog sleeps under the fountain.')),
    ).toBe(null);
    expect(soundForLine(line(2, ''))).toBe(null);
  });

  it('collapses a whole fight to one impact plus the rare events', async () => {
    const { soundsForBatch } = await import('../src/audio/cues');

    const cues = soundsForBatch([
      line(1, 'You hit it for 12 damage.'),
      line(2, 'It hits you for 9 damage.', 'red'),
      line(3, 'A critical blow! 44 damage.'),
      line(4, '+150 experience  +90 gold'),
    ]);

    /* Four lines, but the ear needs one impact, not four. */
    expect(cues.filter((c) => c === 'hit' || c === 'hurt' || c === 'crit')).toHaveLength(1);
    expect(cues).toContain('crit');
    expect(cues).toContain('loot');
  });

  it('puts the award before the blow that earned it', async () => {
    const { soundsForBatch } = await import('../src/audio/cues');

    const cues = soundsForBatch([
      line(1, 'You hit it for 12 damage.'),
      line(2, 'You have reached level VII. {white}Knight{/}'),
    ]);

    expect(cues[0]).toBe('level');
    expect(cues[cues.length - 1]).toBe('hit');
  });

  it('maps keys by intent', async () => {
    const { soundForKey } = await import('../src/audio/cues');

    expect(soundForKey('Enter')).toBe('select');
    expect(soundForKey('Escape')).toBe('back');
    expect(soundForKey('f')).toBe('key');
  });
});
