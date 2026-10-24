import type { Settings } from '../../api/types';

/**
 * Settings.
 *
 * Keyboard-first, but these are real focusable controls — the one place in the
 * game that takes a mouse, because accessibility beats purity. Escape closes.
 *
 * The volume control is a four-step cycle rather than a slider. A slider inside
 * a keyboard-only terminal means arrow keys do double duty, and a terminal game
 * has no business rendering a track and a thumb. Four perceptual steps cover the
 * useful range and cycle with one key.
 */

export interface SettingsPanelProps {
  settings: Settings;
  reducedMotion: boolean;
  onChange(patch: Partial<Settings>): void;
  /** Play a short tone so the player can hear the level they just chose. */
  onPreviewSound(): void;
  onClose(): void;
  /**
   * Live audio diagnostics.
   *
   * The reason this exists: "sound isn't working" has three very different
   * causes — the player muted it, the browser refused to start the audio
   * context, or a sound is genuinely broken — and from the outside they look
   * identical: silence. Guessing at the fix is what turns a one-minute problem
   * into a support thread.
   *
   * So the panel states the truth: is the context running, at what rate, and
   * a button that fires every sound in the catalogue so a partial failure is
   * obvious immediately.
   */
  audio: AudioStatus;
  onTestAllSounds(): void;
}

/** What the audio engine reports about itself. */
export interface AudioStatus {
  /** `none` before the first gesture, then the real AudioContextState. */
  state: AudioContextState | 'none';
  /** The device sample rate, or 0 before the context exists. */
  sampleRate: number;
  /** Whether a context object exists at all. */
  unlocked: boolean;
  /**
   * Whether the ambient bed is actually running.
   *
   * Listed separately from the context because it fails independently: the
   * context can be running perfectly while the room is silent, which is exactly
   * what a mis-scaled ambience level looks like from the outside.
   */
  ambienceLive: boolean;
}

/** The steps the engine quantises to, mirrored here for display. */
const VOLUME_STEPS = [0.3, 0.55, 0.8, 1];
const VOLUME_LABELS = ['LOW', 'MED', 'HIGH', 'MAX'];

function volumeLabel(value: number): string {
  const index = VOLUME_STEPS.indexOf(value);
  if (index >= 0) return VOLUME_LABELS[index];
  /* Fallback for a value that has not been quantised yet. */
  const nearest = VOLUME_STEPS.reduce((best, step) =>
    Math.abs(step - value) < Math.abs(best - value) ? step : best,
  );
  return VOLUME_LABELS[VOLUME_STEPS.indexOf(nearest)];
}

function nextVolume(value: number): number {
  const index = VOLUME_STEPS.indexOf(value);
  if (index < 0) return VOLUME_STEPS[2];
  return VOLUME_STEPS[(index + 1) % VOLUME_STEPS.length];
}

export function SettingsPanel({
  settings,
  reducedMotion,
  onChange,
  onPreviewSound,
  onClose,
  audio,
  onTestAllSounds,
}: SettingsPanelProps) {
  /*
   * The single most useful sentence this panel can say.
   *
   * Browsers refuse to start an AudioContext outside a user gesture, and some
   * refuse entirely — Safari inside a cross-origin iframe, a machine with no
   * output device, a locked-down kiosk. In every one of those cases the game
   * looks exactly like a game with the volume down, and no amount of cycling
   * the volume control helps. Stating the context state turns a mystery into a
   * diagnosis.
   */
  const verdict = !settings.sound
    ? 'Sound is switched off in this panel.'
    : audio.state === 'none'
      ? 'Not started yet — press a key in the game to allow audio.'
      : audio.state === 'suspended'
        ? 'Blocked by the browser. Press a key in the game to allow audio.'
        : audio.state === 'running'
          ? `Running at ${(audio.sampleRate / 1000).toFixed(1)} kHz.`
          : `Context is ${audio.state}.`;

  /*
   * The room gets its own verdict, because it fails independently.
   *
   * Being able to hear a sword but not the wind is a real state — ambience
   * switched off, or switched on but failing to build — and reporting only the
   * context state hid it completely. Two lines, two answers.
   */
  const roomVerdict = !settings.sound
    ? 'Room tone is silent while sound is off.'
    : !settings.ambience
      ? 'Room tone is switched off below.'
      : audio.ambienceLive
        ? 'Room tone is playing.'
        : 'Room tone has not started — press a key in the game.';

  const healthy = settings.sound && audio.state === 'running';

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="settings-panel">
        <div className="settings-head">
          <h2 className="t-bright">SETTINGS</h2>
          <button className="settings-close" onClick={onClose} aria-label="Close settings">
            ESC
          </button>
        </div>

        {/*
          Audio status before any control. This is the answer to "why can't I hear
          anything?" and it should not require opening a console to find.
        */}
        <div className={`audio-status ${healthy ? 'is-healthy' : 'is-unhealthy'}`}>
          <div className="audio-status-head">
            <span className={healthy ? 't-bright' : 't-gold'}>AUDIO</span>
            <span className={`audio-dot ${healthy ? 'is-on' : ''}`} aria-hidden="true" />
          </div>
          <p className="audio-status-line t-base">{verdict}</p>
          <p className="audio-status-line t-dim">{roomVerdict}</p>
          <button
            className="audio-test"
            onClick={onTestAllSounds}
            disabled={!settings.sound}
            aria-label="Play every sound in the game"
          >
            <span className="t-bright">[ TEST EVERY SOUND ]</span>
            <span className="t-ghost"> keys, sword, coins, level-up, the modem</span>
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
            label="Volume"
            hint={
              settings.sound
                ? 'Audition it — this plays a sword hit'
                : 'Sound is off; volume has nothing to act on'
            }
            on={settings.sound}
            disabled={!settings.sound}
            onLabel={volumeLabel(settings.volume)}
            offLabel={volumeLabel(settings.volume)}
            onClick={() => {
              onChange({ volume: nextVolume(settings.volume) });
              /* A preview is the only way to know what "LOW" means. */
              onPreviewSound();
            }}
          />
          <Toggle
            label="Room tone"
            hint="Wind, drips, and the occasional thing that does not belong"
            on={settings.ambience}
            disabled={!settings.sound}
            onClick={() => onChange({ ambience: !settings.ambience })}
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
          Settings are saved in this browser. Audio is synthesised at runtime — no files, no
          downloads.
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
