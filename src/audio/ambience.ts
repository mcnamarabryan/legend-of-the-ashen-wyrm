/**
 * THE ROOM TONE.
 *
 * One scene at a time, rendered from data in `scenes.ts`. This file is the
 * renderer and the scheduler; the *character* of each place lives in the
 * catalogue.
 *
 * THE THREE PROBLEMS ambience has to solve, and where most attempts fail:
 *
 *  1. **Never compete with the narrative.** The bed sits far under the game's
 *     cues. If you notice it as a feature rather than as a room, it is mixed
 *     wrong.
 *  2. **Never loop.** A repeating sample is found by the ear in two passes. Every
 *     bed layer is continuous noise or a detuned pair, and every modulated layer
 *     is driven by two LFOs at rates that do not divide — so nothing completes a
 *     cycle inside a session.
 *  3. **Never be constant.** The gaps matter more than the events. Gaps are
 *     irregular, and a scene may throw an event away entirely, because silence is
 *     part of the pattern.
 *
 * WHAT MAKES IT SOUND NATURAL, concretely:
 *
 *  - **Every event jitters its pitch, gain and duration.** Four firings of the
 *    same tick are four different ticks. This single property does more for
 *    realism than any amount of layering.
 *  - **Ramps, not steps.** Every gain change is an exponential or a
 *    `setTargetAtTime` with a time constant; nothing snaps. Ambience that clicks
 *    reads as broken rather than as quiet.
 *  - **Nothing decays to zero.** An exponential ramp cannot reach zero, so every
 *    envelope targets `SILENCE` (0.0001) rather than 0 — a real fade to zero
 *    would either throw or produce a discontinuity.
 *  - **Events are stacks.** A drip is a drop *and* its reflection; a relay is a
 *    click *and* the chassis taking it. Single-layer events read as beeps.
 *  - **Crossfades are long.** Moving between locations takes over a second,
 *    because a hard switch is the one thing that breaks the illusion of a
 *    continuous world.
 */

import { noiseBufferFor } from './render';
import { SCENES, type AmbienceScene, type BedLayer, type SceneSpec } from './scenes';

/**
 * The full event vocabulary, including the machine-room sounds.
 *
 * Kept here rather than in `scenes.ts` because these are *designs* — frequency
 * and gain relationships — and the scene file is about which ones belong where.
 */
export type AmbienceEvent =
  | 'tick'
  | 'click'
  | 'whirr'
  | 'relay'
  | 'drive'
  | 'vent'
  | 'gust'
  | 'rustle'
  | 'birdsong'
  | 'creak'
  | 'drip'
  | 'groan'
  | 'whisper'
  | 'door'
  | 'cart'
  | 'murmur'
  | 'dog'
  | 'bell'
  | 'rockfall'
  | 'breath';

export type { AmbienceScene };

export interface AmbienceHandle {
  /** Fade the current scene out and release it. */
  stop(): void;
  /** 0–1 master level, ramped so it can duck under the modem. */
  setLevel(level: number): void;
  /**
   * Crossfade to another scene.
   *
   * Safe to call with the current scene — it is a no-op, which matters because
   * the shell re-renders far more often than the location actually changes.
   */
  setScene(scene: AmbienceScene): void;
  /** Which scene is currently playing. */
  readonly scene: AmbienceScene;
  /** Fire one event now. Used by the scheduler and by tests. */
  trigger(event: AmbienceEvent): void;
  readonly level: number;
}

/** The quietest value an exponential ramp may target. */
const SILENCE = 0.0001;

/** Portable timers — see the note in the previous version's history. */
const later = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => setTimeout(fn, ms);
const cancelLater = (id: ReturnType<typeof setTimeout>): void => clearTimeout(id);

/** How long a crossfade takes. Long enough to be a move, short enough to feel prompt. */
const CROSSFADE_S = 1.1;

/** Extra time given to a scene's fade before its nodes are released. */
const RELEASE_MS = 1600;

export function startAmbience(
  ctx: BaseAudioContext,
  destination: AudioNode,
  initial: AmbienceScene = 'forest',
): AmbienceHandle {
  const noise = noiseBufferFor(ctx);

  /* Master for the whole engine. Everything routes here so one ramp can duck. */
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(destination);

  /*
   * A shared reverb send.
   *
   * Scenes differ in how wet they are — a cave is mostly room, a machine room is
   * dead — so the send level is ramped per scene rather than baked into voices.
   * We reuse the convolver that `SoundEngine` already built by asking for a bus:
   * but this module is deliberately standalone, so it builds a small one of its
   * own. Guarded, because a stubbed context may not implement a convolver.
   */
  const send = ctx.createGain();
  send.gain.value = 0.2;
  send.connect(destination);

  /* ------------------------------------------------------------------ */
  /* Per-scene containers                                                */
  /* ------------------------------------------------------------------ */

  interface SceneVoice {
    /** Everything that must be stopped, and when its fade completes. */
    stop(): void;
  }

  interface Live {
    scene: AmbienceScene;
    spec: SceneSpec;
    /** Input gain for the whole scene. Crossfades ramp this. */
    gain: GainNode;
    /** Its own reverb send, so wetness fades with the scene. */
    wet: GainNode;
    voices: SceneVoice[];
    nodes: Array<{ stop(when: number): void }>;
    timers: Array<ReturnType<typeof setTimeout>>;
    stopped: boolean;
  }

  const live = new Set<Live>();
  let current: Live | null = null;
  let level = 0;
  let disposed = false;

  /* ------------------------------------------------------------------ */
  /* Bed construction                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * One bed layer, wired and running.
   *
   * Tone and hum layers are oscillators; noise layers are the shared buffer with
   * a filter. Both may drift, and drift is applied to the filter's frequency or
   * the layer's own gain depending on `target`.
   */
  function buildLayer(layer: BedLayer, into: GainNode, sink: GainNode): SceneVoice {
    const nodes: Array<{ stop(when: number): void }> = [];
    const lfos: OscillatorNode[] = [];

    const env = ctx.createGain();
    env.gain.value = layer.gain;

    /* Place the layer in the stereo field. A mono bed sounds like one speaker. */
    let tail: AudioNode = env;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      /* Deterministic placement, so the same layer lands in the same place. */
      panner.pan.value = (Math.random() * 2 - 1) * 0.55;
      env.connect(panner);
      tail = panner;
    }
    tail.connect(into);
    void sink;

    if (layer.kind === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = layer.filter ?? 'bandpass';
      filter.frequency.value = layer.freq;
      filter.Q.value = layer.Q ?? 1;

      src.connect(filter);
      filter.connect(env);
      src.start(0, Math.random() * 0.5);
      nodes.push(src);

      /* Drift the cutoff. Two rates per layer, never one. */
      for (const d of layer.drift ?? []) {
        const lfo = ctx.createOscillator();
        const amount = ctx.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = d.rate;
        amount.gain.value = d.depth;
        lfo.connect(amount);
        amount.connect(filter.frequency);
        lfo.start();
        lfos.push(lfo);
        nodes.push(lfo);
      }
    } else {
      /* Tone or hum. A hum is the same pitch twice, a fraction apart, so it
         beats slowly — which is what makes a drone feel powered rather than
         synthesised. */
      const base = layer.hz ?? layer.freq;
      const partials: Array<[number, number]> =
        layer.kind === 'hum'
          ? [
              [base, 1],
              [base + (layer.spread ?? 0.3), 0.72],
            ]
          : [[base, 1]];

      for (const [hz, scale] of partials) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = hz;
        g.gain.value = scale;
        osc.connect(g);
        g.connect(env);
        osc.start();
        lfos.push(osc);
        nodes.push(osc);
      }

      /* Drift the *level*, which is how a fan or a crowd breathes. */
      for (const d of layer.drift ?? []) {
        if (d.target === 'freq') continue;
        const lfo = ctx.createOscillator();
        const amount = ctx.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = d.rate;
        /* Depth is a fraction of the layer's own gain, so it scales sensibly. */
        amount.gain.value = layer.gain * d.depth;
        lfo.connect(amount);
        amount.connect(env.gain);
        lfo.start();
        lfos.push(lfo);
        nodes.push(lfo);
      }
    }

    return {
      stop() {
        for (const node of nodes) {
          try {
            node.stop(ctx.currentTime);
          } catch {
            /* already stopped */
          }
        }
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* Scene lifecycle                                                     */
  /* ------------------------------------------------------------------ */

  function buildScene(scene: AmbienceScene): Live {
    const spec = SCENES[scene];

    /* A private gain for this scene. Crossfades ramp this, so every layer
       inside — bed and events alike — fades together without touching each
       node individually. */
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);

    /* A private reverb send, scaled to the scene's wetness. */
    const wet = ctx.createGain();
    wet.gain.value = 0;
    wet.connect(send);
    gain.connect(wet);

    const l: Live = {
      scene,
      spec,
      gain,
      wet,
      voices: [],
      nodes: [],
      timers: [],
      stopped: false,
    };

    for (const layer of spec.bed) {
      l.voices.push(buildLayer(layer, gain, wet));
    }

    /*
     * Schedule the scene's own events.
     *
     * Each scene keeps its own timer chain, so a scene that is fading out keeps
     * its rhythm until it is released rather than going silent abruptly. That
     * detail is what makes the crossfade feel like walking between rooms instead
     * of like a track change.
     */
    const scheduleNext = (): void => {
      if (l.stopped) return;

      const { min, max } = spec.gap;
      const gapMs = (min + Math.random() * (max - min)) * 1000;

      const id = later(() => {
        if (l.stopped) return;

        if (Math.random() > spec.skipChance) {
          const useRare =
            spec.rare && spec.rareChance !== undefined && Math.random() < spec.rareChance;

          if (useRare && spec.rare) {
            fire(spec.rare);
          } else {
            const total = spec.events.reduce((sum, e) => sum + e.weight, 0);
            let roll = Math.random() * total;
            for (const { event, weight } of spec.events) {
              roll -= weight;
              if (roll <= 0) {
                fire(event);
                break;
              }
            }
          }
        }

        scheduleNext();
      }, gapMs);

      l.timers.push(id);
    };

    /* Where an event should be placed in the stereo field. Events are scattered;
       only the bed has fixed positions. */
    const fire = (event: AmbienceEvent): void => {
      if (l.stopped) return;
      l.voices.push(renderEvent(event, gain));
    };

    /*
     * `fire` is captured by `scheduleNext`, which is defined before it. Declaring
     * the timer chain first and the renderer second needs a forward reference, so
     * the renderer is hoisted as a function declaration inside the closure via
     * this assignment. Keeps the scheduling code readable top-to-bottom.
     */
    (l as Live & { fire: (e: AmbienceEvent) => void }).fire = fire;
    scheduleNext();

    return l;
  }

  /* ------------------------------------------------------------------ */
  /* Event rendering                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Render one event into a scene's gain.
   *
   * Every frequency, gain and duration is jittered. That is the property that
   * stops four ticks sounding like one tick played four times, and it costs three
   * multiplications.
   */
  function renderEvent(event: AmbienceEvent, into: GainNode): SceneVoice {
    const now = ctx.currentTime + 0.005;
    const nodes: Array<{ stop(when: number): void }> = [];

    /* Stereo scatter. Wider for organic events, tighter for machinery, because
       a machine room is a small box and a forest is not. */
    const organic = ['gust', 'rustle', 'birdsong', 'drip', 'whisper', 'murmur'].includes(event);
    const spread = organic ? 0.7 : 0.28;

    const panner =
      typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = (Math.random() * 2 - 1) * spread;
      panner.connect(into);
    }
    const out: AudioNode = panner ?? into;

    /** A quick jitter multiplier. */
    const vary = (amp: number) => 1 + (Math.random() * 2 - 1) * amp;

    /** Filtered noise burst. */
    const burst = (
      dur: number,
      gain: number,
      type: BiquadFilterType,
      freq: number,
      to: number | undefined,
      Q: number,
      attack: number,
    ) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;

      const band = ctx.createBiquadFilter();
      band.type = type;
      band.Q.value = Q;
      band.frequency.setValueAtTime(freq, now);
      if (to) band.frequency.exponentialRampToValueAtTime(to, now + dur);

      const env = ctx.createGain();
      env.gain.setValueAtTime(SILENCE, now);
      env.gain.exponentialRampToValueAtTime(gain, now + attack);
      env.gain.exponentialRampToValueAtTime(SILENCE, now + dur);

      src.connect(band);
      band.connect(env);
      env.connect(out);
      src.start(now, Math.random() * 0.7);
      src.stop(now + dur + 0.05);
      nodes.push(src);
    };

    /** A pitched ping, with an optional sweep. */
    const ping = (
      freq: number,
      dur: number,
      gain: number,
      opts: { to?: number; wave?: OscillatorType; delay?: number; filter?: number } = {},
    ) => {
      const at = now + (opts.delay ?? 0);
      const osc = ctx.createOscillator();
      const env = ctx.createGain();

      osc.type = opts.wave ?? 'sine';
      osc.frequency.setValueAtTime(freq, at);
      if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, at + dur);

      env.gain.setValueAtTime(SILENCE, at);
      env.gain.exponentialRampToValueAtTime(gain, at + 0.01);
      env.gain.exponentialRampToValueAtTime(SILENCE, at + dur);

      if (opts.filter) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = opts.filter;
        osc.connect(f);
        f.connect(env);
      } else {
        osc.connect(env);
      }

      env.connect(out);
      osc.start(at);
      osc.stop(at + dur + 0.05);
      nodes.push(osc);
    };

    switch (event) {
      /* ---------------------------------------------------------------- */
      /* Machine                                                          */
      /* ---------------------------------------------------------------- */

      /* A relay closing. High dry click over a small low body. */
      case 'tick': {
        burst(0.012 * vary(0.3), 0.03 * vary(0.3), 'highpass', 3200 * vary(0.1), undefined, 0.8, 0.001);
        ping(210 * vary(0.12), 0.05, 0.012 * vary(0.3), { to: 130, wave: 'triangle' });
        break;
      }

      /* A heavier switch: click, then the chassis taking the shock. */
      case 'click': {
        burst(0.016, 0.034 * vary(0.25), 'bandpass', 2200 * vary(0.15), undefined, 1.6, 0.001);
        ping(128 * vary(0.1), 0.13, 0.024 * vary(0.25), { to: 74, wave: 'triangle' });
        break;
      }

      /* A fan spinning up and coasting. Slow attack — it is accelerating, not
         being struck. */
      case 'whirr': {
        const dur = 0.7 * vary(0.35);
        burst(dur, 0.026 * vary(0.3), 'bandpass', 340 * vary(0.2), 620 * vary(0.15), 2.2, dur * 0.4);
        ping(96 * vary(0.12), dur * 0.9, 0.006, {
          to: 128,
          wave: 'sawtooth',
          delay: 0.02,
          filter: 1200,
        });
        break;
      }

      /* A relay throwing: dry click, then something mechanical taking the load.
         The low body is what separates it from a mouse click. */
      case 'relay': {
        burst(0.016, 0.036 * vary(0.25), 'bandpass', 2400 * vary(0.12), undefined, 1.4, 0.001);
        ping(128 * vary(0.1), 0.13 * vary(0.2), 0.028 * vary(0.25), {
          to: 74,
          wave: 'triangle',
          delay: 0.004,
        });
        break;
      }

      /* A drive spinning up and settling. The sweep is the whole gesture. */
      case 'drive': {
        const dur = 0.85 * vary(0.3);
        burst(dur, 0.026 * vary(0.3), 'bandpass', 300 * vary(0.15), 620 * vary(0.2), 2.4, dur * 0.5);
        ping(96 * vary(0.1), dur * 0.9, 0.007, {
          to: 128,
          wave: 'sawtooth',
          delay: 0.02,
          filter: 900,
        });
        break;
      }

      /* Ventilation surging. No pitch, only air. */
      case 'vent': {
        const dur = 1.4 * vary(0.35);
        burst(dur, 0.022 * vary(0.3), 'bandpass', 500 * vary(0.2), 900 * vary(0.25), 1.2, dur * 0.4);
        break;
      }

      /* ---------------------------------------------------------------- */
      /* Forest                                                           */
      /* ---------------------------------------------------------------- */

      case 'gust': {
        const dur = 3.2 * vary(0.35);
        burst(dur, 0.048 * vary(0.25), 'bandpass', 340 * vary(0.3), 900 * vary(0.3), 0.7, dur * 0.28);
        break;
      }

      case 'rustle': {
        const dur = 0.7 * vary(0.35);
        burst(dur, 0.028 * vary(0.3), 'highpass', 2400 * vary(0.2), undefined, 0.6, 0.14);
        break;
      }

      /* Something bird-shaped, never a real bird: two or three notes with a
         rising tail. A recognisable species would date the game to a biome. */
      case 'birdsong': {
        const base = 1700 * vary(0.3);
        const notes = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < notes; i += 1) {
          ping(base * (1 + i * 0.14), 0.09, 0.018 * vary(0.25), {
            to: base * (1.1 + i * 0.12),
            delay: i * 0.13,
          });
        }
        break;
      }

      /* Wood under load. Slow, low, and slightly detuned against itself. */
      case 'creak': {
        const dur = 0.85 * vary(0.4);
        ping(140 * vary(0.25), dur, 0.02 * vary(0.3), {
          to: 92 * vary(0.2),
          wave: 'triangle',
        });
        break;
      }

      /* A cave drip and its reflection. The reflection is what sells "cave" —
         a drop with no answer is a drop in a wardrobe. */
      case 'drip': {
        const base = 1000 * vary(0.35);
        ping(base, 0.13, 0.042 * vary(0.3), { to: base * 1.55 });
        ping(base * 0.72, 0.24, 0.013 * vary(0.35), { to: base, delay: 0.27 });
        break;
      }

      /* Something large settling. Almost infrasonic. */
      case 'groan': {
        ping(56 * vary(0.2), 1.9, 0.028 * vary(0.3), { to: 43, wave: 'triangle' });
        break;
      }

      /* The one that does not belong. A breath-like swell with an almost-voice
         under it that never resolves — the moment it becomes identifiable it
         stops working. */
      case 'whisper': {
        const dur = 1.5 * vary(0.25);
        burst(dur, 0.024 * vary(0.3), 'bandpass', 1100 * vary(0.2), 640 * vary(0.2), 4.5, dur * 0.3);
        ping(196 * vary(0.12), 1.1, 0.007, { to: 174, wave: 'triangle', delay: 0.33 });
        break;
      }

      /* ---------------------------------------------------------------- */
      /* Town                                                             */
      /* ---------------------------------------------------------------- */

      /* A door: latch, then the frame. */
      case 'door': {
        burst(0.02, 0.022 * vary(0.25), 'bandpass', 1800 * vary(0.2), undefined, 1.4, 0.001);
        ping(88 * vary(0.14), 0.28, 0.022 * vary(0.25), { to: 62, wave: 'triangle', delay: 0.02 });
        break;
      }

      /* A cart on cobbles: irregular wooden knocks, then the axle. */
      case 'cart': {
        const step = 0.115 * vary(0.2);
        burst(0.09, 0.018 * vary(0.3), 'bandpass', 430 * vary(0.2), undefined, 2, 0.01);
        burst(0.08, 0.014 * vary(0.3), 'bandpass', 380 * vary(0.2), undefined, 2, 0.01);
        ping(70 * vary(0.15), 0.12, 0.009, { to: 58, wave: 'sine', delay: step * 2.3 });
        break;
      }

      /* Distant conversation. Band-limited noise shaped like speech — the words
         are gone, only the cadence survives. */
      case 'murmur': {
        const dur = 1.2 * vary(0.4);
        burst(dur, 0.024 * vary(0.3), 'bandpass', 620 * vary(0.18), 470 * vary(0.15), 4.2, dur * 0.25);
        ping(148 * vary(0.12), 0.9, 0.006, { to: 132, wave: 'triangle', delay: 0.1 });
        break;
      }

      case 'dog': {
        const b = 310 * vary(0.15);
        ping(b, 0.11, 0.014 * vary(0.3), { to: b * 0.8, wave: 'sawtooth', filter: 1100 });
        ping(b * 1.06, 0.1, 0.011 * vary(0.3), {
          to: b * 0.84,
          wave: 'sawtooth',
          filter: 1100,
          delay: 0.17,
        });
        break;
      }

      /* Two partials, no third. A third would make it a church bell. */
      case 'bell': {
        const f = 392 * vary(0.02);
        ping(f, 1.5, 0.015 * vary(0.25), {});
        ping(f * 1.5, 1.1, 0.007 * vary(0.25), { to: f * 1.48 });
        break;
      }

      /* ---------------------------------------------------------------- */
      /* Cave                                                             */
      /* ---------------------------------------------------------------- */

      /* Rock letting go somewhere above. Debris, then a settling thud. */
      case 'rockfall': {
        burst(0.22 * vary(0.4), 0.03 * vary(0.3), 'bandpass', 900 * vary(0.3), 400, 1.2, 0.01);
        ping(52 * vary(0.2), 0.5, 0.026 * vary(0.3), { to: 40, wave: 'triangle', delay: 0.12 });
        break;
      }

      /* The lair's rarest sound: something inhaling. Slow, deep, and far bigger
         than the player. */
      case 'breath': {
        const dur = 2.4 * vary(0.25);
        burst(dur, 0.03 * vary(0.25), 'lowpass', 300 * vary(0.2), 520, 1.8, dur * 0.45);
        ping(44 * vary(0.1), dur * 0.8, 0.016 * vary(0.25), { to: 52, wave: 'sine', delay: 0.2 });
        break;
      }
    }

    return {
      stop() {
        for (const node of nodes) {
          try {
            node.stop(ctx.currentTime);
          } catch {
            /* already stopped */
          }
        }
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* Transcription / crossfade                                           */
  /* ------------------------------------------------------------------ */

  function release(l: Live): void {
    if (l.stopped) return;
    l.stopped = true;

    for (const id of l.timers) cancelLater(id);
    l.timers.length = 0;

    const id = later(() => {
      for (const v of l.voices) v.stop();
      l.voices.length = 0;
      live.delete(l);
    }, RELEASE_MS);

    /* Tracked so `stop()` can cancel a pending release. */
    l.timers.push(id);
  }

  function setScene(scene: AmbienceScene): void {
    if (disposed) return;
    if (current?.scene === scene && !current.stopped) return;

    const now = ctx.currentTime;
    const next = buildScene(scene);

    /*
     * Fade the old scene out and the new one in over the same window.
     *
     * Equal-power would be technically correct for correlated sources, but these
     * are *uncorrelated* — one is wind, the other is a fan — and a linear cross
     * of uncorrelated material dips in the middle. Exponential ramps on both,
     * overlapping, avoid that dip.
     */
    if (current) {
      const prev = current;
      prev.gain.gain.cancelScheduledValues(now);
      prev.gain.gain.setValueAtTime(Math.max(SILENCE, prev.gain.gain.value || SILENCE), now);
      prev.gain.gain.exponentialRampToValueAtTime(SILENCE, now + CROSSFADE_S);

      prev.wet.gain.cancelScheduledValues(now);
      prev.wet.gain.exponentialRampToValueAtTime(SILENCE, now + CROSSFADE_S);

      release(prev);
    }

    /*
     * The scene envelope goes to UNITY, not to `level`.
     *
     * This is the bug that made the room tone inaudible everywhere. `level` is
     * the master ambience setting, and `master.gain` already applies it. Ramping
     * the scene envelope to `level` as well squared the value: at a setting of
     * 0.10 the beds reached the bus at 0.01 × 0.21 ≈ 0.002, which is silence
     * with extra steps.
     *
     * The scene envelope is a *crossfade* control — 0 while fading in, 1 while
     * playing — and nothing else. One number, one place.
     */
    next.gain.gain.cancelScheduledValues(now);
    next.gain.gain.setValueAtTime(SILENCE, now);
    next.gain.gain.exponentialRampToValueAtTime(1, now + CROSSFADE_S);

    next.wet.gain.cancelScheduledValues(now);
    next.wet.gain.setValueAtTime(SILENCE, now);
    next.wet.gain.exponentialRampToValueAtTime(Math.max(SILENCE, next.spec.wet), now + CROSSFADE_S);

    live.add(next);
    current = next;
  }

  /* Start. `setLevel` is what actually makes it audible. */
  setScene(initial);

  /* ------------------------------------------------------------------ */
  /* Public surface                                                      */
  /* ------------------------------------------------------------------ */

  return {
    get level() {
      return level;
    },

    get scene(): AmbienceScene {
      return current?.scene ?? initial;
    },

    setLevel(next: number): void {
      if (disposed) return;
      level = Math.max(0, Math.min(1, next));

      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      /* A long ramp. Ambience that snaps in is a jump scare. */
      master.gain.setTargetAtTime(level, now, 0.7);

      /*
       * Deliberately does NOT touch `current.gain`.
       *
       * That gain is the crossfade envelope and holds at unity while a scene
       * plays. Writing `level` into it too applies the level twice — the same
       * mistake as the fade-in had, from the other direction.
       */
    },

    setScene,

    trigger(event: AmbienceEvent): void {
      if (disposed || !current || current.stopped) return;
      current.voices.push(renderEvent(event, current.gain));
    },

    stop(): void {
      if (disposed) return;
      disposed = true;

      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0, now, 0.4);

      for (const l of live) {
        l.gain.gain.cancelScheduledValues(now);
        l.gain.gain.setTargetAtTime(0, now, 0.4);
        l.wet.gain.cancelScheduledValues(now);
        l.wet.gain.setTargetAtTime(0, now, 0.4);
        release(l);
      }
    },
  };
}
