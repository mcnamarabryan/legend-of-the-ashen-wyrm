import { useEffect, useState } from 'react';
import { boot } from '../bootCopy';

/**
 * The boot screen, and the first sound the player hears.
 *
 * THE CONSTRAINT: browsers will not start an AudioContext without a user
 * gesture. A page that constructs one on load gets silence. So the modem
 * handshake cannot literally be the first thing on page load — but it can be
 * the first thing after the first key, which is as close as the platform
 * permits.
 *
 * THE FICTION makes that a feature rather than an apology. A BBS began with you
 * picking up the phone and dialling. This screen asks you to dial in, and that
 * keypress is the gesture that lets the modem answer. Same tick, no gap, no
 * "click to enable audio" modal.
 *
 * THE OFFER: if the player has previously turned sound off, a silent "dial in"
 * prompt would be a lie — pressing the key would produce nothing. So we ask
 * first: turn it on for the full experience, or proceed in silence. Both paths
 * lead into the realm; only one of them has a modem in it. The choice is
 * remembered, so this is asked once, not every visit.
 *
 * This component is presentational: the phase machine lives in App, which owns
 * the keyboard and therefore owns the gesture.
 */

/**
 *   offer     → sound is off. Ask whether to turn it on.
 *   idle      → sound is on. Waiting for the dial gesture.
 *   dialing   → handshake playing. Any key skips to connected.
 *   connected → carrier up (or silent mode). Any key enters.
 */
export type BootPhase = 'offer' | 'idle' | 'dialing' | 'connected';

export interface BootProps {
  reducedMotion: boolean;
  phase: BootPhase;
  /** True when the player is running without audio. */
  silent: boolean;
  /** Accept the sound offer: turn audio on and dial immediately. */
  onAcceptSound(): void;
  /** Decline the sound offer and proceed without it. */
  onDeclineSound(): void;
  /** Start the call. Invoked from a click, which is itself a valid gesture. */
  onDial(): void;
  /** Enter the realm. */
  onEnter(): void;
}

export function Boot({
  reducedMotion,
  phase,
  silent,
  onAcceptSound,
  onDeclineSound,
  onDial,
  onEnter,
}: BootProps) {
  const [step, setStep] = useState(reducedMotion ? 99 : 0);

  /* The printer warms up on its own; only the carrier waits for a human. */
  useEffect(() => {
    if (reducedMotion) {
      setStep(99);
      return;
    }
    if (step >= 99) return;
    const t = window.setTimeout(() => setStep((s) => s + 1), 220);
    return () => window.clearTimeout(t);
  }, [step, reducedMotion]);

  const settled = step >= 99 || reducedMotion;
  const offer = boot.soundOff;

  return (
    <div className="screen screen-boot">
      {boot.lines.map((l, i) => (
        <div className={`term-line ${i < step || step >= 99 ? 'is-shown' : 'is-hidden'}`} key={l}>
          {l}
        </div>
      ))}

      <div className="boot-art" aria-hidden={!settled}>
        {boot.art.map((l, i) => (
          <div className="term-line t-bright" key={i} style={{ animationDelay: `${i * 60}ms` }}>
            {l}
          </div>
        ))}
      </div>

      <div className="boot-footer">
        <div className="term-line t-dim">{boot.footer}</div>

        {phase === 'offer' ? (
          /* A silent dial prompt would be a lie, so ask before pretending. */
          <div className="boot-offer" role="group" aria-label="Sound">
            <div className="term-line t-gold">{offer.headline}</div>
            {offer.body.map((l) => (
              <div className="term-line t-dim" key={l}>
                {l}
              </div>
            ))}

            <button className="boot-choice" onClick={onAcceptSound}>
              <span className="t-bright">{offer.yes}</span>
            </button>
            <button className="boot-choice" onClick={onDeclineSound}>
              <span className="t-dim">{offer.no}</span>
            </button>
            <div className="term-line t-ghost boot-hint">{offer.hint}</div>
          </div>
        ) : phase === 'idle' ? (
          /* The gesture. Everything above is an invitation to press a key,
             because pressing a key is what makes sound possible at all. */
          <button className="boot-dial term-line" onClick={onDial} autoFocus>
            <span className="t-bright">
              {boot.dialPrompt} <span className="cursor">_</span>
            </span>
            <span className="term-line t-ghost boot-hint">{boot.dialHint}</span>
          </button>
        ) : phase === 'dialing' ? (
          <div className="term-line t-dim boot-dialing">
            {boot.asking} <span className="cursor">_</span>
          </div>
        ) : (
          <button className="boot-continue term-line t-bright" onClick={onEnter}>
            {silent ? boot.silent : boot.connected}
          </button>
        )}
      </div>

      {/* The state change is announced without any audio. */}
      <p className="visually-hidden" role="status">
        {phase === 'offer'
          ? 'Sound is off. Press Y to turn it on, or N to continue in silence.'
          : phase === 'idle'
            ? 'Press any key to dial in.'
            : phase === 'dialing'
              ? 'Dialling the node.'
              : silent
                ? 'Connected in silent mode. Press any key to enter.'
                : 'Carrier established. Press any key to enter.'}
      </p>
    </div>
  );
}
