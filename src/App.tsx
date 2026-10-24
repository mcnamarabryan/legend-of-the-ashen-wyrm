import { useCallback, useEffect, useRef, useState } from 'react';
import { useGame } from './state/useGame';
import { Crt } from './ui/Crt';
import { Header } from './ui/Header';
import { TerminalLog } from './ui/TerminalLog';
import { Boot, type BootPhase } from './ui/screens/Boot';
import { Title } from './ui/screens/Title';
import { SettingsPanel } from './ui/screens/Settings';
import { EntryField } from './ui/EntryField';
import { sound } from './audio/SoundEngine';
import type { MenuEntry, WirePrompt } from './api/wire';

/**
 * App shell.
 *
 * One keydown listener. Every keypress skips the typewriter first and acts
 * second — which is how a real BBS door felt when you mashed a key through the
 * scroll.
 *
 * There is no game logic in this file, or anywhere else in `src/`. Keys go out,
 * screens come back.
 *
 * The one piece of state worth explaining is the boot sequence, because it is
 * where the audio policy lives.
 */

/**
 * THE MODEM PATH.
 *
 * How long the handshake runs is no longer declared here. `useGame` reports the
 * duration the engine actually scheduled, so the boot screen waits on the truth
 * rather than on a number copied out of another file.
 *
 * That used to be `const HANDSHAKE_MS = 5900`, with a comment asking the next
 * developer to keep it in step with the timeline in `SoundEngine.handshake()`.
 * Two numbers, two files, nothing enforcing agreement — and the failure mode is
 * subtle: claim the carrier is up 200 ms early and the player hears the modem
 * talking over the menu, which reads as a bug in the game rather than a typo in
 * a constant. It is now derived, so it cannot drift.
 *
 * THE BOOT RUNS ONCE, NOT ON EVERY RELOAD.
 *
 * The handshake is an entrance, and an entrance you sit through on every refresh
 * stops being atmospheric and becomes a toll — worse, it is the gate on the game
 * itself, because you cannot reach your character until it finishes.
 *
 * A returning player therefore starts *connected*: the boot screen is already
 * settled and one keypress from the realm. A first-time visitor still gets the
 * full sequence, because they have never heard it and it is the best thing here.
 * Clearing site data brings the ceremony back, which is correct — it is genuinely
 * new again.
 */
const DIALED_KEY = 'ashen-wyrm.dialled.v1';

function hasDialledBefore(): boolean {
  try {
    return localStorage.getItem(DIALED_KEY) === '1';
  } catch {
    /* Private mode: say no, so a player who cannot persist anything gets the
       sequence consistently rather than skipping it at random. */
    return false;
  }
}

function rememberDialled(): void {
  try {
    localStorage.setItem(DIALED_KEY, '1');
  } catch {
    /* ignore */
  }
}

export default function App() {
  const { state, settings, press, key, reducedMotion, actions, handshakeMs } = useGame();
  const [skipToken, setSkipToken] = useState(0);
  const [typing, setTyping] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const carrierTimer = useRef<number | null>(null);

  /**
   * If sound is off we open on an offer, not a dial prompt.
   *
   * A silent "press any key to dial in" would be a lie — the keypress would
   * produce nothing, and the player would reasonably conclude the game has no
   * sound at all rather than that they turned it off months ago. Asking once,
   * plainly, is the honest version. The answer is remembered, so this appears
   * only for people who have audio switched off.
   */
  const [bootPhase, setBootPhase] = useState<BootPhase>(() => {
    /* No audio: ask, rather than promise a handshake that cannot happen. */
    if (!settings.sound) return 'offer';
    /* A returning player is already connected — see the note above. */
    return hasDialledBefore() ? 'connected' : 'idle';
  });

  const bootDone = bootPhase === 'connected';
  const silent = !settings.sound;
  const onTypingChange = useCallback((t: boolean) => setTyping(t), []);

  /* Follow the newest line. */
  const bodyRef = useRef<HTMLDivElement | null>(null);

  /**
   * Keep the ambience in step with where the player is.
   *
   * TWO RULES, and the boundary between them is the whole point:
   *
   *  1. **Before connection, the room is a machine.** The player is standing in
   *     a maintenance room beside a terminal that is doing something — ticks,
   *     whirrs, a drive spinning up. That palette is deliberately mechanical and
   *     periodic, and it is *unlike* the forest on purpose: the moment the modem
   *     connects, the shift from a cold room to living wind does the work a
   *     paragraph of prose would otherwise have to do.
   *
   *  2. **After connection, the room is wherever they are.** Each location maps to
   *     a scene and movement crossfades, so the inn, the street, the forest and
   *     the mountain are four different rooms rather than one bed with different
   *     text over it.
   *
   * THERE IS NO SILENT SCREEN. Every view maps to a scene, including the title
   * and character creation, which inherit the town. A location that produced no
   * bed would read as the audio having broken — which is exactly what players
   * reported when the level was misapplied and every scene was inaudible.
   *
   * The ambience engine is also *started* here rather than only from `unlock()`.
   * A player who reaches the realm without ever pressing a key the engine
   * recognised — clicking "reconnect", say — would otherwise sit in silence with
   * a perfectly healthy context.
   */
  useEffect(() => {
    if (!settings.ambience) return;

    if (!bootDone) {
      sound.setAmbienceScene('machine');
      return;
    }

    sound.setLocation(state.view);
  }, [bootDone, state.view, settings.ambience]);

  /**
   * The room must follow the *boot phase*, not only the final `connected` flag.
   *
   * During `dialing` the player is still in the machine room — the modem is an
   * object in that room, and the world should not open until the carrier
   * settles. Watching `bootPhase` instead of `bootDone` keeps the ambience alive
   * through the whole sequence rather than leaving the boot idle screen silent.
   */
  useEffect(() => {
    if (!settings.ambience) return;
    if (bootDone) return;
    sound.setAmbienceScene('machine');
  }, [bootPhase, bootDone, settings.ambience]);

  /**
   * Keep the narrative pinned to the bottom.
   *
   * Three separate reasons the naive `scrollTop = scrollHeight` fails here, and
   * all three had to be fixed:
   *
   *  1. **`state.log` is the wrong dependency.** The array only changes identity
   *     when lines are appended. During the typewriter the container grows one
   *     character at a time while the array stays identical, so the effect never
   *     re-ran and the view drifted. `typing` and the log length are what
   *     actually change.
   *
   *  2. **Layout has not happened yet.** Setting scrollTop in the same tick as a
   *     render reads a stale scrollHeight. Deferring to the next frame means the
   *     new line has been laid out before we measure.
   *
   *  3. **The player is allowed to scroll up.** Yanking someone back to the
   *     bottom while they are reading a death message is obnoxious. We only
   *     follow when they are already near the bottom.
   */
  const stickToBottom = useRef(true);

  const pin = useCallback(() => {
    if (!stickToBottom.current) return;
    const el = bodyRef.current;
    if (!el) return;
    /* Deferred one frame so the DOM has been laid out and measured. */
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    const onScroll = () => {
      /* 48px of slack: close enough to the bottom counts as following. */
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottom.current = distance < 48;
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  /* Re-pin when lines are appended and when the screen changes. Continuous
     scrolling DURING the typewriter is handled inside TerminalLog, because this
     component does not re-render per character — the reveal state lives there. */
  useEffect(() => {
    pin();
  }, [state.log.length, state.view, pin]);

  /* Clear the carrier timer on unmount so it cannot fire into nothing. */
  useEffect(() => {
    return () => {
      if (carrierTimer.current !== null) window.clearTimeout(carrierTimer.current);
    };
  }, []);

  /**
   * Begin the call. MUST run inside the keypress handler — same tick — or the
   * browser will treat the AudioContext as gesture-less and suspend it.
   */
  const dialIn = useCallback(() => {
    actions.dial();
    setBootPhase('dialing');

    /* Nothing to wait for when there is nothing to hear. */
    if (reducedMotion || !settings.sound) {
      setBootPhase('connected');
      return;
    }

    if (carrierTimer.current !== null) window.clearTimeout(carrierTimer.current);
    carrierTimer.current = window.setTimeout(() => setBootPhase('connected'), handshakeMs);
  }, [actions, reducedMotion, settings.sound, handshakeMs]);

  /** Leave the boot screen, hanging up if the modem is still talking. */
  const enterRealm = useCallback(() => {
    if (carrierTimer.current !== null) {
      window.clearTimeout(carrierTimer.current);
      carrierTimer.current = null;
    }
    actions.hangUp();
    /* The call happened. Future visits start connected rather than paying the
       same toll again. */
    rememberDialled();
    setBootPhase('connected');
  }, [actions]);

  /**
   * Accept the sound offer.
   *
   * Order matters: enabling audio and starting the handshake must both happen
   * inside this gesture, or the context starts suspended and the modem is
   * silent — the exact failure the offer exists to prevent.
   */
  const acceptSound = useCallback(() => {
    actions.setSettings({ sound: true });
    actions.dial();
    setBootPhase('dialing');

    if (reducedMotion) {
      setBootPhase('connected');
      return;
    }

    if (carrierTimer.current !== null) window.clearTimeout(carrierTimer.current);
    carrierTimer.current = window.setTimeout(() => setBootPhase('connected'), handshakeMs);
  }, [actions, reducedMotion, handshakeMs]);

  /** Decline: continue without audio, skipping a handshake nobody can hear. */
  const declineSound = useCallback(() => {
    setBootPhase('connected');
  }, []);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (showSettings) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowSettings(false);
        }
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      /* Never trap the browser's own tab navigation. */
      if (e.key === 'Tab') return;

      /*
       * THE CLICK COMES FIRST, BEFORE ANY BRANCH CAN SWALLOW THE KEY.
       *
       * Every branch below can ignore this keypress — the boot phase owns the
       * keyboard, the typewriter skip returns early, the busy window drops input,
       * offline retries without acting. All of those were silent as well, because
       * the click lived inside the server-send path. Players mash keys precisely
       * during a typewriter reveal, so the keyboard felt dead most of the time it
       * was being hammered.
       *
       * A key going down is physical whether or not the game has a use for it.
       */
      press(e.key === ' ' || e.key === 'Enter' ? 'enter' : e.key);

      /* ---- the boot sequence owns the keyboard until it settles ---- */
      if (bootPhase !== 'connected') {
        e.preventDefault();
        const k = e.key.toLowerCase();

        if (bootPhase === 'offer') {
          if (k === 'y' || e.key === 'Enter') acceptSound();
          else if (k === 'n' || e.key === 'Escape') declineSound();
          return;
        }
        if (bootPhase === 'idle') {
          dialIn();
          return;
        }
        if (bootPhase === 'dialing') {
          /* Impatient player: skip the rest of the handshake. */
          enterRealm();
        }
        return;
      }

      e.preventDefault();

      /* Offline: a keypress retries rather than queueing. */
      if (state.connection === 'offline') {
        actions.retry();
        return;
      }

      /* Any keypress finishes the current animation; it does not also act. */
      if (typing) {
        setSkipToken((t) => t + 1);
        return;
      }

      if (state.busy) return;

      if (e.key === ' ' || e.key === 'Enter') {
        key('enter');
        return;
      }
      if (e.key === 'Backspace') {
        key('backspace');
        return;
      }
      if (e.key === 'Escape') {
        key('escape');
        return;
      }
      if (e.key.length === 1) {
        key(e.key);
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    key,
    typing,
    showSettings,
    bootPhase,
    state.busy,
    state.connection,
    dialIn,
    enterRealm,
    acceptSound,
    declineSound,
    actions,
  ]);

  const speed = reducedMotion || settings.typewriterMs === 0 ? 0 : settings.typewriterMs;

  return (
    <Crt settings={settings} reducedMotion={reducedMotion}>
      <div className="terminal" data-view={bootDone ? state.view : 'boot'}>
        <Header character={state.character} connection={state.connection} />

        <div className="terminal-body" ref={bodyRef}>
          {!bootDone ? (
            <Boot
              reducedMotion={reducedMotion}
              phase={bootPhase}
              silent={silent}
              onAcceptSound={acceptSound}
              onDeclineSound={declineSound}
              onDial={dialIn}
              onEnter={enterRealm}
            />
          ) : state.connection === 'offline' ? (
            <CarrierLost error={state.error} onRetry={actions.retry} />
          ) : state.view === 'title' ? (
            /*
             * `reducedMotion` is passed through because the title screen now
             * reveals its sections in stages. A staged reveal is motion, and
             * someone who asked for less of it should get the page complete.
             */
            <Title
              character={state.character}
              slots={state.slots}
              reducedMotion={reducedMotion}
            />
          ) : (
            <>
              <TerminalLog
                lines={state.log}
                speed={speed}
                skipToken={skipToken}
                onTypingChange={onTypingChange}
                /* The typewriter lives inside that component, so it is the only
                   thing that can keep the view pinned as characters appear. */
                scrollParent={bodyRef}
                follow={stickToBottom}
              />

              {/*
                The live text field sits BELOW the log, not inside it.

                A log entry is history: it scrolls away and is trimmed at a cap,
                so putting the current name in there would mean it could be
                evicted mid-typing — and the line would drift upward as new
                narrative arrived, which is miserable when the caret is what your
                eye is on.

                `entry` is null for every screen that asks a single-key question,
                which is every screen except the name prompt.
              */}
              {state.entry && <EntryField entry={state.entry} busy={state.busy} />}
            </>
          )}
        </div>

        <Footer
          prompt={state.prompt}
          menu={state.menu}
          view={bootDone ? state.view : 'boot'}
          typing={typing}
          busy={state.busy}
          connection={state.connection}
          audioOff={bootDone && !settings.sound}
        />
      </div>

      {showSettings && (
        <SettingsPanel
          settings={settings}
          reducedMotion={reducedMotion}
          onChange={actions.setSettings}
          /* A volume step is meaningless without hearing it. */
          onPreviewSound={() => sound.play('hit')}
          onClose={() => setShowSettings(false)}
          /*
           * Read the engine's live state at render time rather than mirroring it
           * into React state. The panel only mounts on demand, so mounting IS the
           * refresh: opening it after a keypress shows the truth, which is
           * exactly when a player would look at it.
           */
          audio={{
            state: sound.state,
            sampleRate: sound.sampleRate,
            unlocked: sound.unlocked,
            ambienceLive: sound.ambienceLive,
          }}
          onTestAllSounds={() => sound.testAll()}
        />
      )}

      <button
        className="crt-settings-button"
        onClick={() => setShowSettings(true)}
        aria-label="Open settings"
      >
        SET
      </button>
    </Crt>
  );
}

function CarrierLost({ error, onRetry }: { error: string | null; onRetry(): void }) {
  return (
    <div className="screen screen-title">
      <div className="title-word t-red">NO CARRIER</div>
      <p className="title-tagline t-base">{error ?? 'The node is not answering.'}</p>
      <div className="title-menu">
        <div className="title-option">
          <span className="t-bright">[ANY KEY]</span> <span className="t-base">Reconnect</span>
        </div>
        <button className="boot-continue term-line t-bright" onClick={onRetry}>
          reconnect now <span className="cursor">_</span>
        </button>
      </div>
    </div>
  );
}

function Footer({
  prompt,
  menu,
  view,
  typing,
  busy,
  connection,
  audioOff,
}: {
  prompt: WirePrompt | null;
  menu: MenuEntry[] | null;
  view: string;
  typing: boolean;
  busy: boolean;
  connection: string;
  /** Sound is switched off. Surfaced so silence is never a mystery. */
  audioOff: boolean;
}) {
  const clock = useClock();

  return (
    <footer className="term-footer">
      <div className="footer-left">
        {connection === 'offline' && view !== 'boot' ? (
          <span className="t-red">carrier lost</span>
        ) : busy ? (
          <span className="t-dim">transmitting…</span>
        ) : view === 'boot' ? (
          <span className="t-dim">dialling in</span>
        ) : (
          <>
            {prompt ? (
              <PromptBar prompt={prompt} />
            ) : menu ? (
              <MenuBar entries={menu} />
            ) : view === 'title' ? (
              <span className="t-dim">[N] new · [1-9] load</span>
            ) : (
              <span className="t-dim">[ESC] back</span>
            )}
            {/*
              A permanent, quiet reminder that audio is off.

              The alternative is a player concluding the game is broken, opening
              the console, and finding nothing — because nothing is wrong. One
              visible word costs nothing and answers the question before it is
              asked.
            */}
            {audioOff && (
              <span className="audio-off t-gold" title="Sound is off — open SET">
                {'  ·  '}SOUND OFF
              </span>
            )}
          </>
        )}
      </div>

      <div className="footer-right">
        <span className={`cursor ${typing || busy ? 'is-solid' : ''}`} aria-hidden="true">
          _
        </span>
        <span className="t-dim" suppressHydrationWarning>
          {clock}
        </span>
      </div>
    </footer>
  );
}

/**
 * A prompt's key list, rendered honestly.
 *
 * A range like `1-9` is not one key, so bracketing it would lie. Everything
 * else — letters, digits, named keys — is a single keypress and reads the same
 * way, so the footer is consistent instead of half-bracketed.
 */
function PromptBar({ prompt }: { prompt: WirePrompt }) {
  return (
    <span className="t-bright">
      {prompt.keys.map((k, i) => (
        <span key={`${k}-${i}`}>
          {i > 0 ? <span className="t-ghost"> </span> : null}
          <KeyChip k={k} />
        </span>
      ))}{' '}
      <span className="t-dim">{prompt.label.replace(/\{[^}]*\}/g, '')}</span>
      {prompt.hint ? <span className="t-ghost"> · {prompt.hint}</span> : null}
    </span>
  );
}

function KeyChip({ k }: { k: string }) {
  if (/^\d+-\d+$/.test(k)) return <span className="t-bright">{k}</span>;
  return <span className="t-bright">[{k.toUpperCase()}]</span>;
}

function MenuBar({ entries }: { entries: MenuEntry[] }) {
  return (
    <span className="menubar" aria-label="Main menu">
      {entries.map(({ key, label }) => (
        <span className="menu-item" key={key}>
          <span className="t-bright">[{key}]</span>
          <span className="t-base">{label}</span>
        </span>
      ))}
    </span>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
