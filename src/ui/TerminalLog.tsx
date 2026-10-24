import { useEffect, useRef, useState } from 'react';
import type { ClientLine } from '../state/client';
import { TerminalLine, visibleLength } from './Markup';

/**
 * The narrative log — and the typewriter that delivers it.
 *
 * The BBS feel depends on pacing: lines arrive one after another, not as a
 * wall. This component plays a batch back in sequence, revealing characters at
 * `speed` ms each, with a short beat between lines so the eye can follow.
 *
 * Four things are load-bearing:
 *
 *  1. **Newness is tracked by line id, not array length.** The log is trimmed
 *     at a cap, so its length stops changing once full. The animation state is
 *     derived from "every line whose id is beyond what I have already shown".
 *
 *  2. **The animation timeline is computed once per batch.** A ref-held
 *     deadline plus a ticking clock means React re-renders cannot restart or
 *     shorten the reveal.
 *
 *  3. **Skip finishes the batch, not the line.** A player mashing keys through
 *     a long fight is not made to mash once per line.
 *
 *  4. **Scrolling happens HERE, not in the shell.** This is the only component
 *     that re-renders while characters appear. A parent effect keyed on the log
 *     array would fire when the batch arrives and then go quiet for the whole
 *     two-second reveal, so the view would drift below the fold — which is
 *     exactly the "doesn't always scroll to the bottom" bug.
 *
 * `role="log"` + `aria-live="polite"` announces new entries without
 * interrupting whatever a screen reader was already saying.
 */

export interface LogProps {
  lines: ClientLine[];
  /** ms per character. 0 disables the typewriter entirely. */
  speed: number;
  /** Injected so a parent keypress can skip the animation. */
  skipToken: number;
  onTypingChange?(typing: boolean): void;
  /** The scrollable container. Owned by the shell, driven from here. */
  scrollParent?: React.RefObject<HTMLDivElement | null>;
  /** Shared "is the player at the bottom" flag, so we do not fight them. */
  follow?: React.MutableRefObject<boolean>;
}

/** Pause between lines once a line has finished typing. */
const LINE_PAUSE_MS = 90;

export function TerminalLog({
  lines,
  speed,
  skipToken,
  onTypingChange,
  scrollParent,
  follow,
}: LogProps) {
  /* Highest id the player has fully seen. Everything above it is new. */
  const [shownId, setShownId] = useState<number>(() => highestId(lines));
  /* Characters of the current batch that are visible right now. */
  const [revealed, setRevealed] = useState(0);

  const skipRef = useRef(skipToken);
  const rafRef = useRef<number | null>(null);

  const topId = highestId(lines);
  const pending = lines.filter((l) => l.id > shownId);
  const isPlaying = pending.length > 0 && speed > 0;

  /* Tell the shell whether the cursor should blink or sit solid. */
  useEffect(() => {
    onTypingChange?.(isPlaying);
  }, [isPlaying, onTypingChange]);

  /**
   * Keep the view pinned while the batch types out.
   *
   * An effect on `revealed` runs once per animation frame, which is precisely
   * the cadence we need: every time another slice of text is committed, the
   * container may have grown, so we re-measure and follow. Cheap — one
   * scrollTop write per frame, and only when the player is at the bottom.
   */
  useEffect(() => {
    if (follow && !follow.current) return;
    const el = scrollParent?.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [revealed, lines, follow, scrollParent]);

  /* Instant mode (or reduced motion): accept the batch immediately. */
  useEffect(() => {
    if (speed > 0) return;
    if (topId > shownId) {
      setShownId(topId);
      setRevealed(0);
    }
  }, [speed, topId, shownId]);

  /* Play the pending batch. */
  useEffect(() => {
    if (!isPlaying) return;

    const lengths = pending.map((l) => visibleLength(l.text));
    const totalChars = lengths.reduce((a, b) => a + b, 0);
    const totalMs = totalChars * speed + pending.length * LINE_PAUSE_MS;
    const startSkip = skipRef.current;

    const started = performance.now();
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      setShownId(topId);
      setRevealed(0);
    };

    const tick = (now: number) => {
      /* A skip request mid-flight ends the batch immediately. */
      if (skipRef.current !== startSkip) {
        finish();
        return;
      }

      const elapsed = now - started;
      if (elapsed >= totalMs) {
        finish();
        return;
      }

      /* Walk the timeline to find how many characters are due right now. */
      let budget = elapsed;
      let chars = 0;

      for (let i = 0; i < lengths.length; i += 1) {
        const lineMs = lengths[i] * speed;
        if (budget >= lineMs) {
          budget -= lineMs + LINE_PAUSE_MS;
          chars += lengths[i];
          if (budget < 0) break;
        } else {
          chars += Math.floor(budget / speed);
          break;
        }
      }

      setRevealed(Math.max(0, chars));
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    /* Keyed on the batch identity, not on `revealed` — that is what stops the
       animation from resetting itself on every frame. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownId, topId, speed, isPlaying, skipToken]);

  /* Skip from the outside (the shell increments skipToken on a keypress). */
  useEffect(() => {
    if (skipToken === skipRef.current) return;
    skipRef.current = skipToken;
    if (topId > shownId) {
      setShownId(topId);
      setRevealed(0);
    }
  }, [skipToken, topId, shownId]);

  /* Distribute the current reveal budget across the pending lines. */
  let budget = revealed;

  return (
    <div className="term-log" role="log" aria-live="polite" aria-label="Narrative">
      {lines.map((line) => {
        /* Already fully seen. */
        if (line.id <= shownId) {
          return <TerminalLine key={line.id} line={line} />;
        }

        /* Currently typing: show a prefix. */
        if (budget <= 0) return null;

        const len = visibleLength(line.text);
        const take = Math.min(len, budget);
        budget -= len;
        return <TerminalLine key={line.id} line={line} reveal={take} />;
      })}
    </div>
  );
}

/** Highest line id, or 0 when the log is empty. */
function highestId(lines: ClientLine[]): number {
  let max = 0;
  for (const l of lines) if (l.id > max) max = l.id;
  return max;
}
