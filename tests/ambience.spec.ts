import { describe, expect, it, vi } from 'vitest';

/**
 * THE ROOM TONE.
 *
 * Ambience is easy to write and hard to get right, so these tests pin the
 * properties that make it ambient rather than annoying:
 *
 *  1. **It starts silent and fades.** Ambience that arrives at full volume is a
 *     jump scare, and a jump scare is the opposite of a room.
 *  2. **It is not a loop.** Beds are continuous noise or detuned oscillator
 *     pairs with two incommensurable LFOs. Only *noise* buffers may loop —
 *     looping noise is seamless because there is no period to hear.
 *  3. **Scenes are distinct.** A cave and a machine room must not share a
 *     palette, or one of them is lying about where the player is.
 *  4. **It stops cleanly.** Stopping must cancel every timer, or a hidden tab
 *     keeps waking up to play drips into nothing.
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

class FakePanner extends FakeNode {
  pan = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  detune = new FakeParam();
  start = vi.fn();
  stop = vi.fn();

  constructor() {
    super();
    /* Record every frequency scheduled, so a test can prove repeats differ. */
    this.frequency.setValueAtTime = vi.fn((value: number) => {
      scheduledFreqs.push(value);
    });
  }
}

/**
 * Frequencies scheduled by every oscillator the fake has created.
 *
 * Module-level on purpose: the point is to observe scheduling across a whole
 * test rather than to track individual nodes. Reset it in any test that inspects
 * it.
 */
let scheduledFreqs: number[] = [];

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

class FakeAudioContext {
  state = 'running' as const;
  currentTime = 0;
  sampleRate = 48000;

  oscillators = 0;
  bufferSources = 0;
  gains: FakeGain[] = [];
  /** Every buffer source, so we can assert on which ones loop. */
  sources: FakeBufferSource[] = [];

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
    const s = new FakeBufferSource();
    this.sources.push(s);
    return s;
  };

  createBiquadFilter = () => new FakeFilter();
  createStereoPanner = () => new FakePanner();

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

function fakeCtx() {
  return new FakeAudioContext();
}

/** A fresh module instance, so each test gets its own caches. */
async function fresh() {
  vi.resetModules();
  return import('../src/audio/ambience');
}

/* ------------------------------------------------------------------ */
/* The catalogue itself                                               */
/* ------------------------------------------------------------------ */

describe('scenes — the catalogues', () => {
  it('defines a scene for every location the game can show', async () => {
    vi.resetModules();
    const { sceneForLocation, SCENES } = await import('../src/audio/scenes');

    /* Every location the server can put the player on. If one of these ever
       returns undefined the engine would crossfade to silence. */
    const locations = [
      'hub',
      'forest',
      'shop',
      'bank',
      'healer',
      'inn',
      'pvp',
      'dragon',
      'character',
      'who',
      'hall',
      'title',
      'create',
    ];

    for (const loc of locations) {
      const scene = sceneForLocation(loc);
      expect(SCENES[scene], `${loc} → ${scene} has no spec`).toBeDefined();
    }
  });

  it('sends the wyrm to its lair and the forest to the forest', async () => {
    const { sceneForLocation } = await import('../src/audio/scenes');

    /* These two are the ones a mistake would be most audible in. */
    expect(sceneForLocation('dragon')).toBe('lair');
    expect(sceneForLocation('forest')).toBe('forest');
  });

  it('falls back to a quiet indoor scene for anything unknown', async () => {
    const { sceneForLocation } = await import('../src/audio/scenes');

    /* A new screen must not be silent. Indoors is the quieter failure. */
    expect(sceneForLocation('some-new-screen')).toBe('town');
  });

  it('gives the machine room a mechanical palette, not a forest one', async () => {
    const { SCENES } = await import('../src/audio/scenes');

    const machine = SCENES.machine.events.map((e) => e.event);
    const forest = SCENES.forest.events.map((e) => e.event);

    /* The whole point of the pre-dial room is that it does not sound like
       outside. If these ever converge, the transition stops meaning anything. */
    expect(machine).toContain('tick');
    expect(machine).toContain('whirr');
    expect(forest).not.toContain('tick');
    expect(forest).not.toContain('whirr');

    expect(forest).toContain('gust');
    expect(machine).not.toContain('gust');
  });

  it('makes the machine room tick faster than the forest breathes', async () => {
    const { SCENES } = await import('../src/audio/scenes');

    /* Machinery is periodic; weather is not. The gap ranges encode that. */
    expect(SCENES.machine.gap.max).toBeLessThan(SCENES.forest.gap.min * 3);
    expect(SCENES.machine.gap.min).toBeLessThan(SCENES.forest.gap.min);
  });

  it('keeps the lair nearly silent on purpose', async () => {
    const { SCENES } = await import('../src/audio/scenes');

    /* A room that quiet is a threat. Filling it with noises makes it an
       attraction instead. */
    expect(SCENES.lair.gap.min).toBeGreaterThan(SCENES.town.gap.min);
    expect(SCENES.lair.skipChance).toBeGreaterThan(0.3);
  });

  it('gives the cave the wettest room and the machine the driest', async () => {
    const { SCENES } = await import('../src/audio/scenes');

    /* Reverb is most of what separates two spaces with similar palettes. */
    expect(SCENES.cave.wet).toBeGreaterThan(SCENES.forest.wet);
    expect(SCENES.machine.wet).toBeLessThan(SCENES.town.wet);
  });

  it('gives every bed at least one modulated layer', async () => {
    const { SCENES, SCENE_IDS } = await import('../src/audio/scenes');

    /*
     * A bed with no modulation is a still tone, and a still tone is heard as a
     * fault rather than as a room. Every scene must breathe somewhere.
     */
    for (const id of SCENE_IDS) {
      const modulated = SCENES[id].bed.filter((l) => l.drift && l.drift.length > 0);
      expect(modulated.length, `${id} has no drifting layer`).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------------------------ */
/* The bed                                                            */
/* ------------------------------------------------------------------ */

describe('ambience — the bed', () => {
  it('builds a layered bed rather than a single drone', async () => {
    const ctx = fakeCtx();
    const { startAmbience } = await fresh();

    const handle = startAmbience(ctx as never, new FakeNode() as never, 'forest');

    /* Oscillators (sub + LFOs) and at least two looping noise beds. */
    expect(ctx.oscillators).toBeGreaterThanOrEqual(3);
    expect(ctx.bufferSources).toBeGreaterThanOrEqual(2);

    handle.stop();
  });

  it('starts at zero and fades rather than snapping in', async () => {
    const ctx = fakeCtx();
    const { startAmbience } = await fresh();

    const handle = startAmbience(ctx as never, new FakeNode() as never, 'forest');

    handle.setLevel(0.5);

    /* A ramp, not a jump. `setValueAtTime` on the master would be a click. */
    const usedRamp = ctx.gains.some(
      (g) => (g.gain as unknown as FakeParam).setTargetAtTime.mock.calls.length > 0,
    );
    expect(usedRamp).toBe(true);
    expect(handle.level).toBe(0.5);

    handle.stop();
  });

  it('clamps the level into 0–1', async () => {
    const ctx = fakeCtx();
    const { startAmbience } = await fresh();

    const handle = startAmbience(ctx as never, new FakeNode() as never, 'forest');

    handle.setLevel(5);
    expect(handle.level).toBe(1);

    handle.setLevel(-3);
    expect(handle.level).toBe(0);

    handle.stop();
  });

  it('never loops a pitched source', async () => {
    const ctx = fakeCtx();
    const { startAmbience } = await fresh();

    const handle = startAmbience(ctx as never, new FakeNode() as never, 'forest');

    /*
     * Looping noise is seamless — there is no period to hear. Looping a tone
     * would produce an audible seam, so only noise may ever loop.
     */
    for (const source of ctx.sources) {
      if (source.loop) {
        expect(source.buffer, 'a looping source must be noise').toBeTruthy();
      }
    }

    handle.stop();
  });
});

/* ------------------------------------------------------------------ */
/* Scenes and crossfades                                              */
/* ------------------------------------------------------------------ */

describe('ambience — moving between rooms', () => {
  it('reports the scene it was started with', async () => {
    const ctx = fakeCtx();
    const { startAmbience } = await fresh();

    const handle = startAmbience(ctx as never, new FakeNode() as never, 'machine');
    expect(handle.scene).toBe('machine');

    handle.stop();
  });

  it('crossfades rather than cutting when the scene changes', async () => {
    const ctx = fakeCtx();
    const { startAmbience } = await fresh();

    const handle = startAmbience(ctx as never, new FakeNode() as never, 'machine');
    const before = ctx.oscillators;

    handle.setScene('forest');

    /* A new scene is built — so new oscillators — and the old one is faded out
       rather than stopped dead. */
    expect(ctx.oscillators).toBeGreaterThan(before);
    expect(handle.scene).toBe('forest');

    handle.stop();
  });

  it('ignores a request for the scene already playing', async () => {
    const ctx = fakeCtx();
    const { startAmbience } = await fresh();

    const handle = startAmbience(ctx as never, new FakeNode() as never, 'forest');
    const before = ctx.oscillators;

    /* The shell re-renders on every keystroke, so this is called constantly. */
    handle.setScene('forest');
    handle.setScene('forest');
    handle.setScene('forest');

    expect(ctx.oscillators).toBe(before);

    handle.stop();
  });

  it('can move through every scene without throwing', async () => {
    const ctx = fakeCtx();
    const { startAmbience } = await fresh();
    const { SCENE_IDS } = await import('../src/audio/scenes');

    const handle = startAmbience(ctx as never, new FakeNode() as never, 'machine');

    for (const id of SCENE_IDS) {
      expect(() => handle.setScene(id), `moving to ${id} threw`).not.toThrow();
      expect(handle.scene).toBe(id);
    }

    handle.stop();
  });
});

/* ------------------------------------------------------------------ */
/* Events                                                             */
/* ------------------------------------------------------------------ */

describe('ambience — the events', () => {
  /** Every event name the engine can render. */
  const EVENTS = [
    'tick',
    'click',
    'whirr',
    'relay',
    'drive',
    'vent',
    'gust',
    'rustle',
    'birdsong',
    'creak',
    'drip',
    'groan',
    'whisper',
    'door',
    'cart',
    'murmur',
    'dog',
    'bell',
    'rockfall',
    'breath',
  ] as const;

  it('fires every named event without throwing', async () => {
    const ctx = fakeCtx();
    const { startAmbience } = await fresh();

    const handle = startAmbience(ctx as never, new FakeNode() as never, 'forest');

    for (const event of EVENTS) {
      expect(() => handle.trigger(event), `${event} threw`).not.toThrow();
    }

    handle.stop();
  });

  it('actually builds a graph for each event', async () => {
    const ctx = fakeCtx();
    const { startAmbience } = await fresh();
    const handle = startAmbience(ctx as never, new FakeNode() as never, 'forest');

    for (const event of EVENTS) {
      const before = ctx.gains.length + ctx.oscillators + ctx.bufferSources;
      handle.trigger(event);
      const after = ctx.gains.length + ctx.oscillators + ctx.bufferSources;
      expect(after, `${event} built nothing`).toBeGreaterThan(before);
    }

    handle.stop();
  });

  it('does not produce identical repeats', async () => {
    const ctx = fakeCtx();
    const { startAmbience } = await fresh();
    const handle = startAmbience(ctx as never, new FakeNode() as never, 'machine');

    /*
     * THE PROPERTY THAT MAKES IT SOUND ALIVE.
     *
     * Every event jitters its pitch and gain, so twelve ticks are twelve
     * different ticks. We record the frequencies actually scheduled and require
     * them to differ — a hardcoded constant would produce exactly one value.
     */
    scheduledFreqs = [];
    for (let i = 0; i < 12; i += 1) handle.trigger('tick');

    const distinct = new Set(scheduledFreqs.map((f) => Math.round(f)));
    expect(scheduledFreqs.length).toBeGreaterThan(0);
    expect(distinct.size, 'repeats were identical').toBeGreaterThan(1);

    handle.stop();
  });

  it('refuses to fire after stop', async () => {
    const ctx = fakeCtx();
    const { startAmbience } = await fresh();

    const handle = startAmbience(ctx as never, new FakeNode() as never, 'forest');
    handle.stop();

    const before = ctx.oscillators;
    handle.trigger('gust');
    handle.trigger('whisper');

    /* Nothing new should be created once stopped. */
    expect(ctx.oscillators).toBe(before);
  });

  it('refuses to change scene after stop', async () => {
    const ctx = fakeCtx();
    const { startAmbience } = await fresh();

    const handle = startAmbience(ctx as never, new FakeNode() as never, 'forest');
    handle.stop();

    const before = ctx.oscillators;
    handle.setScene('cave');
    expect(ctx.oscillators).toBe(before);
  });
});

/* ------------------------------------------------------------------ */
/* Lifecycle                                                          */
/* ------------------------------------------------------------------ */

describe('ambience — lifecycle', () => {
  it('cancels its timers on stop so nothing fires into a dead tab', async () => {
    vi.resetModules();

    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const ctx = fakeCtx();
    const { startAmbience } = await import('../src/audio/ambience');

    const handle = startAmbience(ctx as never, new FakeNode() as never, 'forest');
    handle.stop();

    /* Each scene sets one timeout per gap; stop must clear them. */
    expect(clearSpy).toHaveBeenCalled();

    clearSpy.mockRestore();
  });

  it('is idempotent on stop', async () => {
    const ctx = fakeCtx();
    const { startAmbience } = await fresh();

    const handle = startAmbience(ctx as never, new FakeNode() as never, 'forest');

    expect(() => {
      handle.stop();
      handle.stop();
      handle.stop();
    }).not.toThrow();
  });

  it('runs headlessly, without a DOM', async () => {
    /*
     * The whole reason the timers are portable. A previous version reached for
     * `window.setTimeout` in `stop()`, which threw a ReferenceError here — and
     * would have shipped as "ambience silently never plays" anywhere non-DOM.
     */
    const ctx = fakeCtx();
    const { startAmbience } = await fresh();

    const handle = startAmbience(ctx as never, new FakeNode() as never, 'machine');
    handle.setLevel(0.6);
    handle.setScene('forest');
    expect(() => handle.stop()).not.toThrow();
  });
});
