import type { Settings } from '../../api/types';

/**
 * Settings.
 *
 * Keyboard-first, but these are real focusable controls — the one place in the
 * game that takes a mouse, because accessibility beats purity. Escape closes.
 */

export interface SettingsPanelProps {
  settings: Settings;
  reducedMotion: boolean;
  onChange(patch: Partial<Settings>): void;
  onClose(): void;
}

export function SettingsPanel({ settings, reducedMotion, onChange, onClose }: SettingsPanelProps) {
  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="settings-panel">
        <div className="settings-head">
          <h2 className="t-bright">SETTINGS</h2>
          <button className="settings-close" onClick={onClose} aria-label="Close settings">
            ESC
          </button>
        </div>

        <ul className="settings-list">
          <Toggle
            label="Scanlines"
            hint="Horizontal lines across the phosphor"
            on={settings.scanlines}
            onClick={() => onChange({ scanlines: !settings.scanlines })}
          />
          <Toggle
            label="Flicker"
            hint="A slow, subtle tube flicker"
            on={settings.flicker && !reducedMotion}
            disabled={reducedMotion}
            onClick={() => onChange({ flicker: !settings.flicker })}
          />
          <Toggle
            label="Grain"
            hint="Static noise, 3% opacity"
            on={settings.grain}
            onClick={() => onChange({ grain: !settings.grain })}
          />
          <Toggle
            label="Curvature"
            hint="Barrel distortion, under 1%"
            on={settings.curvature && !reducedMotion}
            disabled={reducedMotion}
            onClick={() => onChange({ curvature: !settings.curvature })}
          />
          <Toggle
            label="Sound"
            hint="Modem, keyclicks and impacts — synthesised, not sampled"
            on={settings.sound}
            onClick={() => onChange({ sound: !settings.sound })}
          />
          <Toggle
            label="Theme"
            hint={settings.theme === 'green' ? 'Green phosphor' : 'Amber phosphor'}
            on={settings.theme === 'amber'}
            onLabel="AMBER"
            offLabel="GREEN"
            onClick={() => onChange({ theme: settings.theme === 'green' ? 'amber' : 'green' })}
          />
          <Toggle
            label="Contrast boost"
            hint="Brighter phosphor, stronger bloom"
            on={settings.contrastBoost}
            onClick={() => onChange({ contrastBoost: !settings.contrastBoost })}
          />
          <Toggle
            label="Typewriter"
            hint={settings.typewriterMs === 0 ? 'Instant text' : '18ms per character'}
            on={settings.typewriterMs > 0}
            disabled={reducedMotion}
            onLabel="SLOW"
            offLabel="INSTANT"
            onClick={() => onChange({ typewriterMs: settings.typewriterMs === 0 ? 18 : 0 })}
          />
        </ul>

        {reducedMotion && (
          <p className="settings-note t-dim">
            Your system asks for reduced motion. Flicker, curvature, the boot animation, and the
            typewriter are disabled and cannot be turned back on from here.
          </p>
        )}

        <p className="settings-note t-ghost">
          Settings are saved with your character, in this browser.
        </p>
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  on,
  onClick,
  disabled,
  onLabel = 'ON',
  offLabel = 'OFF',
}: {
  label: string;
  hint: string;
  on: boolean;
  onClick(): void;
  disabled?: boolean;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <li>
      <button
        className="settings-row"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={on}
        aria-label={`${label}: ${on ? onLabel : offLabel}`}
      >
        <span className="settings-label">{label}</span>
        <span className="settings-hint t-dim">{hint}</span>
        <span className={`settings-state ${on ? 'is-on' : ''}`}>{on ? onLabel : offLabel}</span>
      </button>
    </li>
  );
}
