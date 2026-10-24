import type { WireEntry } from '../api/wire';

/**
 * LIVE TEXT ENTRY.
 *
 * The name prompt is the only place in the game where you type free text instead
 * of pressing a single command key — and it was the one place the screen showed
 * nothing at all. Every keystroke produced no narrative line, and the header had
 * no character yet, so the player was typing into a void: you could not see your
 * name, could not tell whether a key had registered, and could not see what
 * backspace had removed.
 *
 * This renders what the server says has been entered. Three details matter:
 *
 *  - **The value comes from the wire, not from local state.** The server is
 *    accumulating the keystrokes, so it is the server that knows the truth. We
 *    do not mirror input locally and we do not optimistically echo — which means
 *    a dropped keypress shows up as a dropped character rather than the display
 *    silently disagreeing with what will actually be saved.
 *
 *  - **The caret is a caret, not a hint.** It sits immediately after the last
 *    character and blinks on the same rhythm as the footer cursor, because it is
 *    the same thing: where input goes next.
 *
 *  - **A counter appears only when it starts to matter.** The limit is sixteen
 *    characters; showing "4/16" from the first keystroke is noise, so it fades in
 *    once you are within four of the cap. That is the point at which a silent
 *    refusal to accept another character would otherwise be confusing.
 */

export interface EntryFieldProps {
  entry: WireEntry;
  /** True while a response is in flight — the caret goes solid. */
  busy: boolean;
}

export function EntryField({ entry, busy }: EntryFieldProps) {
  const value = entry.value;
  const max = entry.max ?? 0;
  const remaining = max > 0 ? max - value.length : Infinity;
  const showCount = max > 0 && remaining <= 4;

  return (
    <div className="term-entry">
      <div className="term-line t-dim entry-label">{entry.label}</div>

      <div className="term-line entry-input" aria-hidden="true">
        <span className="entry-prompt t-dim">{'>'}{'\u00a0'}</span>
        {value.length > 0 ? (
          <span className="t-bright">{value}</span>
        ) : (
          /* An empty field still needs to look like a place to type. */
          <span className="t-ghost">…</span>
        )}
        <span className={`cursor ${busy ? 'is-solid' : ''}`}>_</span>
      </div>

      <div className="term-line t-ghost entry-meta">
        {entry.hint ?? ''}
        {showCount ? <span className="entry-count"> {value.length}/{max}</span> : null}
      </div>

      {/*
        The visible field is decorative — the real input is the global keydown
        listener, so there is nothing to focus. A screen reader still needs to
        hear the current value as it changes, which this does without stealing
        focus or duplicating the visual line.
      */}
      <p className="visually-hidden" role="status">
        {value.length > 0
          ? `${entry.label} ${value}, ${value.length} characters.`
          : `${entry.label} Empty.`}
      </p>
    </div>
  );
}
