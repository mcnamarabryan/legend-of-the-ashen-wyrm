import { useEffect, useRef, useState } from 'react';
import type { HeaderCharacter, SlotSummary } from '../../api/wire';

/**
 * Title screen / character picker.
 *
 * Lists the characters the SERVER says exist in this realm. The client does not
 * know their stats — only what the realm was willing to say.
 *
 * THE REVEAL.
 *
 * Everything here used to appear at once. That had two consequences, and the
 * second was a real bug:
 *
 *  1. A title screen that snaps into place reads as a page load, not as a boot
 *     sequence. The whole point of the CRT framing is that something is coming
 *     up.
 *
 *  2. The screen is a scrolling container. Arriving with all the content already
 *     present meant the roster and the menu pushed the ASCII wordmark above the
 *     fold, so "LEGEND" was genuinely not visible without scrolling back up.
 *     In other words: the first thing a new player saw was the *bottom* of the
 *     title screen.
 *
 * So the reveal is staged: the art lands first, the tagline follows, then the
 * roster, then the menu. Each stage is a real delay, and the scroll position is
 * pinned to the top as they arrive, which keeps the wordmark in frame for as
 * long as possible. By the time the menu appears the art has had a second on
 * screen, and the container is short enough that nothing important is clipped.
 *
 * Under `prefers-reduced-motion` every stage is shown immediately. A reveal is
 * motion; someone who has asked for less of it should not be made to sit through
 * one.
 */

export interface TitleProps {
  character: HeaderCharacter | null;
  slots: SlotSummary[];
  /** Honour the system preference: show everything at once. */
  reducedMotion?: boolean;
}

/** Stage timings in ms. Cumulative, so each is a deadline from mount. */
const STAGE = {
  art: 0,
  tagline: 260,
  roster: 620,
  menu: 980,
} as const;

export function Title({ character, slots, reducedMotion = false }: TitleProps) {
  const currentKey = character ? character.name.trim().toLowerCase() : null;
  const rootRef = useRef<HTMLDivElement | null>(null);

  /* How many stages have been revealed. 4 = all of them. */
  const [stage, setStage] = useState(reducedMotion ? 4 : 0);

  useEffect(() => {
    if (reducedMotion) {
      setStage(4);
      return;
    }

    const timers: number[] = [];
    if (stage < 1) timers.push(window.setTimeout(() => setStage(1), STAGE.art + 1));
    if (stage < 2) timers.push(window.setTimeout(() => setStage(2), STAGE.tagline));
    if (stage < 3) timers.push(window.setTimeout(() => setStage(3), STAGE.roster));
    if (stage < 4) timers.push(window.setTimeout(() => setStage(4), STAGE.menu));

    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
    /* Keyed on the stage so each pass schedules only what is still missing. */
  }, [stage, reducedMotion]);

  /**
   * Keep the wordmark in frame while the screen builds.
   *
   * The parent is the scroll container, and it may already be scrolled from a
   * previous screen. Pinning to the top on every stage means the art stays put
   * as the rest of the page grows beneath it — the exact opposite of the old
   * behaviour, where the content arrived fully-formed and pushed it away.
   */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const scroller = el.closest('.terminal-body') as HTMLElement | null;
    if (!scroller) return;

    if (stage < 4) {
      scroller.scrollTop = 0;
    }
  }, [stage]);

  const show = (n: number) => stage >= n;

  return (
    <div className="screen screen-title" ref={rootRef}>
      <div className="title-art">
        <pre className="title-block t-bright" aria-hidden="true">{`
  ██▓     ▓█████   ▄████ ▓█████  ███▄    █ ▓█████▄
  ▓██▒     ▓█   ▀  ██▒ ▀█▒▓█   ▀  ██ ▀█   █ ▒██▀ ██▌
  ▒██░     ▒███   ▒██░▄▄▄░▒███   ▓██  ▀█ ██▒░██   █▌
  ▒██░     ▒▓█  ▄ ░▓█  ██▓▒▓█  ▄ ▓██▒  ▐▌██▒░▓█▄   ▌
  ░██████▒ ░▒████▒░▒▓███▀▒░▒████▒▒██░   ▓██░░▒████▓
  ░ ▒░▓  ░ ░░ ▒░ ░ ░▒   ▒ ░░ ▒░ ░░ ▒░   ▒ ▒  ▒▒▓  ▒
`}</pre>
        <div className="title-word t-bright">ASHEN WYRM</div>
        <div className="title-rule t-dim">{'─'.repeat(54)}</div>
        <div className="title-sub t-dim">BKM REALM NODE 01 · 2400 BAUD · 1 NODE</div>
      </div>

      <p className={`title-tagline t-base reveal ${show(2) ? 'is-shown' : ''}`}>
        Ten turns a day. A forest full of monsters. One dragon at the end of it.
      </p>

      {slots.length > 0 && (
        <div className={`title-roster reveal ${show(3) ? 'is-shown' : ''}`}>
          <div className="title-roster-head t-dim">
            {slots.length === 1 ? 'ONE CHARACTER ON THIS NODE' : 'CHARACTERS ON THIS NODE'}
          </div>
          {slots.slice(0, 9).map((s, i) => {
            const isCurrent = s.name.trim().toLowerCase() === currentKey;
            return (
              <div className={`title-roster-row ${isCurrent ? 'is-current' : ''}`} key={s.name}>
                <span className="t-bright">[{i + 1}]</span>{' '}
                <span className={isCurrent ? 't-bright' : 't-base'}>{s.name.padEnd(15)}</span>
                <span className="t-dim">
                  {s.className.padEnd(9)} lvl {s.levelRoman.padEnd(4)}{' '}
                  {s.retired ? 'retired' : s.title}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className={`title-menu reveal ${show(4) ? 'is-shown' : ''}`}>
        <div className="title-option">
          <span className="t-bright">[N]</span> <span className="t-base">A new character</span>
        </div>
        {slots.length > 0 && (
          <div className="title-option">
            <span className="t-dim">[1-9]</span>{' '}
            <span className="t-dim">Load a character</span>
          </div>
        )}
      </div>

      <div className={`title-footer t-dim reveal ${show(4) ? 'is-shown' : ''}`}>
        keyboard only · the realm is decided on the node, not in this tab
      </div>
    </div>
  );
}
