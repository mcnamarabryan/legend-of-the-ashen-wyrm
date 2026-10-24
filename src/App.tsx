import { useCallback, useEffect, useRef, useState } from 'react';
import { useGame } from './state/useGame';
import { Crt } from './ui/Crt';
import { Header } from './ui/Header';
import { TerminalLog } from './ui/TerminalLog';
import { Boot, type BootPhase } from './ui/screens/Boot';
import { Title } from './ui/screens/Title';
import { SettingsPanel } from './ui/screens/Settings';
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
 * How long the modem handshake runs before the carrier counts as established.
 *
 * This MUST stay in step with the timeline in `SoundEngine.handshake()`. Too
 * short and the screen claims CARRIER ESTABLISHED while the modem is still
 * screeching; too long and the player waits in silence after the noise ends.
 * About 200ms of slack lets the final CRT thunk land first.
 */
const HANDSHAKE_MS = 5900;

export default function App() {
  const { state, settings, key, reducedMotion, actions } = useGame();
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
  const [bootPhase, setBootPhase] = useState<BootPhase>(() =>
    settings.sound ? 'idle' : 'offer',
  );

  const bootDone = bootPhase === 'connected';
  const silent = !settings.sound;
  const onTypingChange = useCallback((t: boolean) => setTyping(t), []);

  /* Follow the newest line. */
  const bodyRef = useRef<HTMLDivElement | null>(null);

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
    carrierTimer.current = window.setTimeout(() => setBootPhase('connected'), HANDSHAKE_MS);
  }, [actions, reducedMotion, settings.sound]);

  /** Leave the boot screen, hanging up if the modem is still talking. */
  const enterRealm = useCallback(() => {
    if (carrierTimer.current !== null) {
      window.clearTimeout(carrierTimer.current);
      carrierTimer.current = null;
    }
    actions.hangUp();
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
    carrierTimer.current = window.setTimeout(() => setBootPhase('connected'), HANDSHAKE_MS);
  }, [actions, reducedMotion]);

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
            <Title character={state.character} slots={state.slots} />
          ) : (
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
          )}
        </div>

        <Footer
          prompt={state.prompt}
          menu={state.menu}
          view={bootDone ? state.view : 'boot'}
          typing={typing}
          busy={state.busy}
          connection={state.connection}
        />
      </div>

      {showSettings && (
        <SettingsPanel
          settings={settings}
          reducedMotion={reducedMotion}
          onChange={actions.setSettings}
          onClose={() => setShowSettings(false)}
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
}: {
  prompt: WirePrompt | null;
  menu: MenuEntry[] | null;
  view: string;
  typing: boolean;
  busy: boolean;
  connection: string;
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
        ) : prompt ? (
          <PromptBar prompt={prompt} />
        ) : menu ? (
          <MenuBar entries={menu} />
        ) : view === 'title' ? (
          <span className="t-dim">[N] new · [1-9] load</span>
        ) : (
          <span className="t-dim">[ESC] back</span>
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
