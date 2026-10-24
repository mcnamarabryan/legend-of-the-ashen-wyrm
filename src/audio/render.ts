/**
 * THE RENDERER.
 *
 * Turns a `SoundDesign` into audio. This file knows nothing about what a sword
 * is or when to play one — it takes a description and speaks it.
 *
 * THE GRAPH, per voice:
 *
 *     osc ──► toneFilter ─┐
 *                         ├──► pan ──► envelope ──┬──► dry ──┐
 *     noise ─► noiseFilter┘                      └──► send ─┤
 *                                                            ├─► master ─► comp ─► out
 *     (other voices share the same pan/envelope shape)       │
 *     reverb: send ──► convolver ──► wet ────────────────────┘
 *
 * Three decisions in that graph are load-bearing:
 *
 *  - **Tone and noise get separate filters.** A single lowpass shared between a
 *    200 Hz body and a 3 kHz crack means one of them is always wrong. Splitting
 *    them is the difference between "impact" and "thud with fizz".
 *
 *  - **The envelope is on the output, not the source.** Enveloping after the
 *    filter means the tail decays through the filter rather than into
 *    silence-then-filter, which avoids the dull click of a cut tail.
 *
 *  - **Reverb is a send, not an insert.** Each voice chooses how wet it is, so
 *    a keyclick can be bone dry in a room where a death rattle is soaked.
 *
 * ENVELOPE SHAPE. The spec is explicit: an exponential ramp cannot reach zero,
 * and ramping to a tiny value over a long hold produces a "fade" rather than a
 * decay. Percussive voices therefore ramp from peak toward `SILENCE` across the
 * whole duration with a curve, which is what a struck object actually does.
 */

import { SILENCE, type SoundDesign, type Voice } from './Voice';
import { harmonicsFor, makeWave, WAVE_FALLBACK } from './waves';

export interface RenderContext {
  ctx: BaseAudioContext;
  /** Everything is summed here before the compressor. */
  master: GainNode;
  /** Wet path. Voices post to this via their own send gain. */
  reverb: GainNode;
}

/**
 * Build the fixed part of the graph: master bus, compressor, reverb.
 *
 * Called once per context. Returns the destination that voices connect to.
 */
export function buildBus(ctx: BaseAudioContext, destination: AudioNode): RenderContext {
  const master = ctx.createGain();
  master.gain.value = 1;

  /*
   * A compressor on the bus, not per sound.
   *
   * The master setting is a gentle safety net: threshold −16 dB, 4:1, slow-ish
   * release. It should be inaudible on a single sound and only engage when a
   * level-up arpeggio lands on top of a sword hit. Aggressive settings here
   * would pump, and pumping is worse than the clipping it prevents.
   */
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 16;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.18;

  master.connect(compressor);
  compressor.connect(destination);

  /*
   * Reverb bus. The convolver needs an impulse response, which `SoundEngine`
   * supplies — it owns the one buffer. Here we only create the plumbing and
   * hand the wet path back to the caller to finish.
   */
  const reverb = ctx.createGain();
  reverb.gain.value = 1;

  const wet = ctx.createGain();
  wet.gain.value = 0.32;
  reverb.connect(wet);
  wet.connect(master);

  return { ctx, master, reverb };
}

/**
 * Render one sound design.
 *
 * `when` is an absolute context time. Everything is scheduled against it, so a
 * design renders identically whether it plays now or 400 ms from now.
 *
 * `jitter` is applied by the caller through `detune` — this function stays pure
 * so the same design plus the same `when` always produces the same graph.
 */
export function renderSound(
  bus: RenderContext,
  design: SoundDesign,
  when: number,
  options: { pan?: number; detune?: number; reverbSend?: number } = {},
): void {
  const trim = design.trim ?? 1;
  const drift = options.detune ?? 0;

  for (const voice of design.voices) {
    renderVoice(bus, voice, when, trim, drift, options);
  }
}

function renderVoice(
  bus: RenderContext,
  voice: Voice,
  when: number,
  trim: number,
  drift: number,
  options: { pan?: number; detune?: number; reverbSend?: number },
): void {
  const { ctx } = bus;

  const start = when + Math.max(0, voice.at);
  const end = start + Math.max(0.01, voice.dur);

  const attack = Math.max(0.0005, voice.attack ?? 0.006);
  const hold = Math.max(0, voice.hold ?? 0);

  /* Peak gain. Divided by trim so a design-level trim scales the whole stack. */
  const peak = Math.max(SILENCE * 2, voice.gain * trim);

  /* ---- sources -------------------------------------------------- */

  const tone = ctx.createGain();
  tone.gain.value = 1;

  let tonalSource: OscillatorNode | null = null;

  if (voice.freq > 0) {
    const osc = ctx.createOscillator();
    const kind = voice.wave ?? 'tri';

    /*
     * Band-limited where possible. `harmonicsFor` shrinks the series as pitch
     * rises, which is what keeps a 2 kHz pulse from aliasing into gravel.
     */
    const wave = makeWave(ctx, kind, harmonicsFor(voice.freq, ctx.sampleRate));
    if (wave) {
      osc.setPeriodicWave(wave);
    } else {
      osc.type = WAVE_FALLBACK[kind];
    }

    const base = voice.freq * Math.pow(2, drift / 1200);
    osc.frequency.setValueAtTime(base, start);
    if (voice.to && voice.to !== voice.freq) {
      /* Exponential sweep, because pitch is perceived logarithmically. */
      const target = Math.max(20, voice.to) * Math.pow(2, drift / 1200);
      osc.frequency.exponentialRampToValueAtTime(target, end);
    }

    if (voice.detune) osc.detune.setValueAtTime(voice.detune, start);

    /* Vibrato, if asked for. An LFO into the oscillator's own detune param is
       the cheapest correct way to do this — no extra gain in the audio path. */
    if (voice.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = voice.vibrato.rate;
      depth.gain.value = voice.vibrato.depth;
      lfo.connect(depth);
      depth.connect(osc.detune);
      lfo.start(start);
      lfo.stop(end + 0.05);
    }

    /* A per-voice lowpass to tame the top end of buzzy timbres. */
    if (voice.toneFilter) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(voice.toneFilter, start);
      filter.Q.value = 0.7;
      osc.connect(filter);
      filter.connect(tone);
    } else {
      osc.connect(tone);
    }

    tonalSource = osc;
  }

  /* Noise layer, sharing the voice's envelope. */
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0;

  /* ---- routing -------------------------------------------------- */

  const panner =
    typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
  if (panner) {
    const pan = options.pan ?? voice.pan ?? 0;
    panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), start);
  }

  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(SILENCE, start);

  /* Send to the room. Voices may override the sound's default. */
  const send = ctx.createGain();
  send.gain.value = 0.0001;
  const sendLevel = options.reverbSend ?? voice.send ?? 0;

  /* Assemble: sources → envelope → pan → (dry | send) */
  tone.connect(envelope);
  if (noiseGain) noiseGain.connect(envelope);

  const tail = panner ?? envelope;
  if (panner) envelope.connect(panner);

  tail.connect(bus.master);

  if (sendLevel > 0 && bus.reverb) {
    send.gain.setValueAtTime(sendLevel, start);
    (panner ?? envelope).connect(send);
    send.connect(bus.reverb);
  }

  /* ---- envelope ------------------------------------------------- */

  const gain = envelope.gain;
  gain.setValueAtTime(SILENCE, start);

  if (voice.shape === 'sustain') {
    gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.setValueAtTime(peak, start + attack + hold);
    gain.exponentialRampToValueAtTime(SILENCE, end);
  } else {
    /*
     * Percussive: fast rise, then a continuous fall across the whole duration.
     *
     * The two-stage ramp matters. A single exponential from SILENCE to peak and
     * back gives a symmetrical swell, which sounds like a violin swell — wrong
     * for an impact. Ramping in over `attack` and then away over the remainder
     * is what makes a strike read as struck.
     */
    gain.exponentialRampToValueAtTime(peak, start + attack);
    const falloff = voice.falloff ?? 2;
    /* An extra intermediate point shapes the curve without needing a WaveShaper. */
    const mid = start + attack + (end - start - attack) * 0.28;
    gain.exponentialRampToValueAtTime(Math.max(SILENCE, peak * Math.pow(0.28, falloff)), mid);
    gain.exponentialRampToValueAtTime(SILENCE, end);
  }

  /* ---- noise ---------------------------------------------------- */

  if (voice.noise && voice.noise > 0) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBufferFor(ctx);
    src.loop = true;

    let node: AudioNode = src;

    if (voice.noiseFilter) {
      const filter = ctx.createBiquadFilter();
      filter.type = voice.noiseFilter.type;
      filter.frequency.setValueAtTime(Math.max(20, voice.noiseFilter.freq), start);
      filter.Q.value = voice.noiseFilter.Q ?? 1;
      if (voice.noiseFilter.to) {
        filter.frequency.exponentialRampToValueAtTime(
          Math.max(20, voice.noiseFilter.to),
          end,
        );
      }
      src.connect(filter);
      node = filter;
    }

    noiseGain.gain.setValueAtTime(voice.noise * 0.9, start);
    node.connect(noiseGain);

    /* Random offset into the shared buffer so repeats differ. */
    src.start(start, Math.random() * 0.7);
    src.stop(end + 0.02);
  }

  /* ---- teardown ------------------------------------------------- */

  if (tonalSource) {
    tonalSource.start(start);
    tonalSource.stop(end + 0.03);
  }

  /*
   * Nothing is explicitly disconnected.
   *
   * Every node here is connected only to something downstream, and a source that
   * has stopped is automatically released by the graph. Manually disconnecting
   * would need a timer per voice and risks tearing down a node mid-release — the
   * spec's own dynamic-lifetime example relies on exactly this behaviour.
   */
}

/* ------------------------------------------------------------------ */
/* Shared noise                                                        */
/* ------------------------------------------------------------------ */

const NOISE_CACHE = new WeakMap<BaseAudioContext, AudioBuffer>();

/**
 * One second of white noise per context, generated once.
 *
 * Generating noise per hit allocates a buffer on every keystroke; at ten keys a
 * second that is garbage collection the player hears as stutter. The spec calls
 * this out as the reason to reuse a single buffer, and it is right.
 */
export function noiseBufferFor(ctx: BaseAudioContext): AudioBuffer {
  const cached = NOISE_CACHE.get(ctx);
  if (cached) return cached;

  const length = Math.floor(ctx.sampleRate);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  /*
   * Pink-ish noise rather than pure white.
   *
   * White noise has equal energy per hertz, which is why it sounds like hiss
   * rather than wind. A one-pole filter tilting the spectrum down by about 3 dB
   * per octave gives a sound much closer to cloth, steel and breath — the
   * materials this game is made of.
   */
  let b0 = 0;
  let b1 = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099;
    b1 = 0.963 * b1 + white * 0.2965;
    data[i] = (b0 + b1 + white * 0.1848) * 0.28;
  }

  NOISE_CACHE.set(ctx, buffer);
  return buffer;
}
