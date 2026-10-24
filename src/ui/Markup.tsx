import type { ReactNode } from 'react';
import type { CombatLine } from '../api/types';

/**
 * Inline markup → real DOM spans.
 *
 * {bright}  bright phosphor      {dim}   dark green
 * {red}     damage/death         {gold}  amber
 * {white}   near-white           {/}     reset to base
 *
 * Text is always real DOM text — selectable, screen-readable, never canvas.
 */

type Tone = 'base' | 'bright' | 'dim' | 'red' | 'gold' | 'white';

const TONE_CLASS: Record<Tone, string> = {
  base: 't-base',
  bright: 't-bright',
  dim: 't-dim',
  red: 't-red',
  gold: 't-gold',
  white: 't-white',
};

const OPENERS: Record<string, Tone> = {
  '{bright}': 'bright',
  '{dim}': 'dim',
  '{red}': 'red',
  '{gold}': 'gold',
  '{white}': 'white',
};
const RESET = '{/}';

interface Token {
  text: string;
  tone: Tone;
}

export function tokenize(input: string, baseTone: Tone = 'base'): Token[] {
  const tokens: Token[] = [];
  let tone: Tone = baseTone;
  let buffer = '';
  let i = 0;

  const flush = () => {
    if (buffer.length > 0) {
      tokens.push({ text: buffer, tone });
      buffer = '';
    }
  };

  while (i < input.length) {
    const rest = input.slice(i);

    if (rest.startsWith(RESET)) {
      flush();
      tone = baseTone;
      i += RESET.length;
      continue;
    }

    let matched = false;
    for (const opener of Object.keys(OPENERS)) {
      if (rest.startsWith(opener)) {
        flush();
        tone = OPENERS[opener];
        i += opener.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    buffer += input[i];
    i += 1;
  }

  flush();
  return tokens;
}

/** Strip markup — used for aria labels and plain-text export. */
export function stripMarkup(input: string): string {
  return tokenize(input)
    .map((t) => t.text)
    .join('');
}

export function renderMarkup(input: string): ReactNode {
  const tokens = tokenize(input);
  if (tokens.length === 0) return '\u00a0';
  return tokens.map((t, idx) => (
    <span key={idx} className={TONE_CLASS[t.tone]}>
      {t.text}
    </span>
  ));
}

/** Visible character count, ignoring markup tags. */
export function visibleLength(input: string): number {
  return stripMarkup(input).length;
}

/** Progressive slice of markup for the typewriter, without breaking tags. */
export function sliceMarkup(input: string, count: number): string {
  let visible = 0;
  let out = '';
  let i = 0;

  while (i < input.length && visible < count) {
    const rest = input.slice(i);

    if (rest.startsWith(RESET)) {
      out += RESET;
      i += RESET.length;
      continue;
    }

    let matched = false;
    for (const opener of Object.keys(OPENERS)) {
      if (rest.startsWith(opener)) {
        out += opener;
        i += opener.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    out += input[i];
    visible += 1;
    i += 1;
  }

  return out;
}

export interface RenderedLineProps {
  line: CombatLine;
  /** Characters to reveal; omit to show the whole line. */
  reveal?: number;
}

export function TerminalLine({ line, reveal }: RenderedLineProps) {
  const content = reveal === undefined ? line.text : sliceMarkup(line.text, reveal);
  if (line.text === '') return <div className="term-line term-blank" aria-hidden="true" />;
  return <div className="term-line">{renderMarkup(content)}</div>;
}
