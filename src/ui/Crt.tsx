import type { ReactNode } from 'react';
import type { Settings } from '../api/types';

/**
 * The CRT shell.
 *
 * Six effect layers, each independently toggleable, all pointer-events:none
 * so they never eat a keypress or a text selection:
 *
 *   1. scanlines      4. flicker
 *   2. vignette       5. grain
 *   3. curvature      6. power-on
 *
 * Contrast guard: the phosphor sits on #050805 at ~11:1. The layers are tuned
 * so they never drag body text below 7:1. contrastBoost exists for people who
 * still find the bloom too soft.
 */

export interface CrtProps {
  settings: Settings;
  reducedMotion: boolean;
  children: ReactNode;
}

export function Crt({ settings, reducedMotion, children }: CrtProps) {
  const classes = [
    'crt',
    `theme-${settings.theme}`,
    settings.scanlines ? 'has-scanlines' : '',
    settings.flicker && !reducedMotion ? 'has-flicker' : '',
    settings.grain ? 'has-grain' : '',
    settings.curvature && !reducedMotion ? 'has-curvature' : '',
    settings.contrastBoost ? 'has-contrast-boost' : '',
    reducedMotion ? 'is-reduced-motion' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <div className="crt-screen">
        {!reducedMotion && <div className="crt-power-on" aria-hidden="true" />}
        {children}
        {settings.scanlines && <div className="crt-scanlines" aria-hidden="true" />}
        <div className="crt-vignette" aria-hidden="true" />
        {settings.grain && <div className="crt-grain" aria-hidden="true" />}
      </div>
    </div>
  );
}
