import type { QualitySetting } from '../game/render/quality';
import { DEFAULT_SETTINGS, type Settings, useGameStore } from '../store/useGameStore';

/**
 * One settings panel shared by the main menu and the pause menu.
 * Everything applies immediately and is saved locally.
 */
export function SettingsPanel({ compact = false }: { compact?: boolean }) {
  const s = useGameStore((st) => st.settings);
  const update = useGameStore((st) => st.updateSettings);
  const range = (key: keyof Settings, label: string, min: number, max: number, step: number, fmt: (v: number) => string) => (
    <label className="set-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={s[key] as number} aria-label={label} onChange={(e) => update({ [key]: Number(e.target.value) } as Partial<Settings>)} />
      <output>{fmt(s[key] as number)}</output>
    </label>
  );
  const toggle = (key: keyof Settings, label: string, hint?: string) => (
    <label className="set-row toggle">
      <input type="checkbox" checked={s[key] as boolean} onChange={(e) => update({ [key]: e.target.checked } as Partial<Settings>)} />
      <span>
        {label}
        {hint && <small className="muted"> — {hint}</small>}
      </span>
    </label>
  );
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className={`settings-panel ${compact ? 'compact' : ''}`} data-testid="settings-panel">
      <fieldset>
        <legend>Touch controls</legend>
        <div className="seg" role="radiogroup" aria-label="Touch layout">
          {(['compact', 'classic'] as const).map((k) => (
            <button key={k} role="radio" aria-checked={s.controlScheme === k} className={s.controlScheme === k ? 'on' : ''} onClick={() => update({ controlScheme: k })}>
              {k === 'compact' ? 'Compact (Kick + wheel)' : 'Classic (all buttons)'}
            </button>
          ))}
        </div>
        {range('controlOpacity', 'Button opacity', 0.35, 1, 0.05, pct)}
        {range('controlScale', 'Button size', 0.85, 1.25, 0.05, pct)}
        {toggle('leftHanded', 'Left-handed layout', 'techniques on the left, joystick on the right')}
        {!compact && toggle('forceTouch', 'Always show touch controls')}
      </fieldset>
      <fieldset>
        <legend>Camera &amp; comfort</legend>
        {toggle('cameraAssist', 'Camera assistance', 'lock-on view drifts back to the side when you stop steering')}
        {toggle('reduceShake', 'Reduce camera shake')}
        {toggle('reduceFlash', 'Reduce hit flashes')}
      </fieldset>
      <fieldset>
        <legend>Audio</legend>
        {toggle('muted', 'Mute')}
        {range('volume', 'Master', 0, 1, 0.05, pct)}
        {range('sfxVolume', 'Effects', 0, 1, 0.05, pct)}
        {range('ambientVolume', 'Ambience', 0, 1, 0.05, pct)}
      </fieldset>
      {!compact && (
        <fieldset>
          <legend>Graphics</legend>
          <label className="set-row">
            <span>Quality</span>
            <select value={s.quality} onChange={(e) => update({ quality: e.target.value as QualitySetting })} aria-label="Graphics quality">
              <option value="auto">Auto</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          {toggle('menuScene', 'Animated menu background', 'off shows a still backdrop and saves battery')}
          {toggle('showPerf', 'Performance overlay')}
        </fieldset>
      )}
      <button
        className="ghost"
        onClick={() =>
          update({
            controlOpacity: DEFAULT_SETTINGS.controlOpacity,
            controlScale: DEFAULT_SETTINGS.controlScale,
            leftHanded: false,
            cameraAssist: true,
            reduceShake: false,
            reduceFlash: false,
          })
        }
      >
        Reset controls &amp; comfort
      </button>
    </div>
  );
}
