import type { QualitySetting } from '../game/render/quality';
import { DEFAULT_SETTINGS, type Settings, useGameStore } from '../store/useGameStore';
import { GroupLabel, QuietButton, SettingChoice, SettingLink, SettingSlider, SettingToggle } from './kit';

const pct = (v: number) => `${Math.round(v * 100)}`;

/**
 * Every game preference, built from the shared setting rows. Used by the
 * main menu (two columns on desktop) and the pause menu (`compact`: the
 * in-match subset, one column). Everything applies immediately and saves.
 */
export function SettingsPanel({ compact = false, onControls }: { compact?: boolean; onControls?: () => void }) {
  const s = useGameStore((st) => st.settings);
  const update = useGameStore((st) => st.updateSettings);
  const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) => update({ [k]: v } as Partial<Settings>);
  return (
    <div className={`settings ${compact ? 'compact' : ''}`} data-testid="settings-panel">
      <div className="settings-col">
        <section>
          <GroupLabel>Controls</GroupLabel>
          <SettingChoice
            label="Touch layout"
            value={s.controlScheme}
            onChange={set('controlScheme')}
            options={[
              ['compact', 'Compact'],
              ['classic', 'Classic'],
            ]}
          />
          <SettingSlider label="Button opacity" value={s.controlOpacity} min={0.35} max={1} step={0.05} onChange={set('controlOpacity')} format={pct} />
          <SettingSlider label="Button size" value={s.controlScale} min={0.85} max={1.25} step={0.05} onChange={set('controlScale')} format={pct} />
          <SettingToggle label="Left-handed layout" hint="Techniques on the left, joystick on the right" checked={s.leftHanded} onChange={set('leftHanded')} />
          {!compact && <SettingToggle label="Always show touch controls" checked={s.forceTouch} onChange={set('forceTouch')} />}
          {onControls && <SettingLink label="Control reference" onClick={onControls} testid="open-controls" />}
        </section>
        <section>
          <GroupLabel>Camera &amp; comfort</GroupLabel>
          <SettingToggle label="Camera assistance" hint="Lock-on view drifts back to the side when you stop steering" checked={s.cameraAssist} onChange={set('cameraAssist')} />
          <SettingToggle label="Reduce camera shake" checked={s.reduceShake} onChange={set('reduceShake')} />
          <SettingToggle label="Reduce hit flashes" checked={s.reduceFlash} onChange={set('reduceFlash')} />
        </section>
      </div>
      <div className="settings-col">
        <section>
          <GroupLabel>Audio</GroupLabel>
          <SettingToggle label="Mute" checked={s.muted} onChange={set('muted')} />
          <SettingSlider label="Master" value={s.volume} min={0} max={1} step={0.05} onChange={set('volume')} format={pct} />
          <SettingSlider label="Effects" value={s.sfxVolume} min={0} max={1} step={0.05} onChange={set('sfxVolume')} format={pct} />
          <SettingSlider label="Ambience" value={s.ambientVolume} min={0} max={1} step={0.05} onChange={set('ambientVolume')} format={pct} />
        </section>
        {!compact && (
          <section>
            <GroupLabel>Graphics</GroupLabel>
            <SettingChoice<QualitySetting>
              label="Quality"
              value={s.quality}
              onChange={set('quality')}
              options={[
                ['auto', 'Auto'],
                ['low', 'Low'],
                ['medium', 'Med'],
                ['high', 'High'],
              ]}
            />
            <SettingToggle label="Animated menu background" hint="Off shows a still backdrop and saves battery" checked={s.menuScene} onChange={set('menuScene')} />
            <SettingToggle label="Performance overlay" checked={s.showPerf} onChange={set('showPerf')} />
          </section>
        )}
        <QuietButton
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
        </QuietButton>
        {!compact && (
          <section className="about">
            <GroupLabel>About</GroupLabel>
            <p className="caption">Inspired by Taekwondo — not an official rules reference or grading. Character: CC0 Quaternius mannequin; techniques are original procedural animation.</p>
          </section>
        )}
      </div>
    </div>
  );
}

/** Keyboard, touch and gamepad reference (real bindings). */
export function ControlsReference() {
  return (
    <div className="controls-ref">
      <section>
        <GroupLabel>Keyboard</GroupLabel>
        <ul>
          <li>
            <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> footwork, camera-relative (<kbd>D</kbd> steps toward the opponent in the default view) · <kbd>Shift</kbd> dash (no direction = back-step)
          </li>
          <li>
            <kbd>J</kbd> punch · <kbd>K</kbd> front kick · <kbd>L</kbd> roundhouse · <kbd>U</kbd> side kick · <kbd>I</kbd> back kick (turning)
          </li>
          <li>
            Hold <kbd>F</kbd> with <kbd>K</kbd> / <kbd>L</kbd> / <kbd>U</kbd> for lead-leg kicks · hold <kbd>E</kbd> to aim at the head · hold <kbd>Space</kbd> to guard
          </li>
          <li>
            <kbd>Q</kbd> switch stance · <kbd>Tab</kbd> lock-on · mouse drag or wheel for the camera · <kbd>Esc</kbd> pause
          </li>
        </ul>
      </section>
      <section>
        <GroupLabel>Touch — Compact (default)</GroupLabel>
        <ul>
          <li>Thumb anywhere on your movement side: floating joystick.</li>
          <li>Kick: tap to throw the selected kick. Slide from it (or hold) to open the wheel — inner ring lead-leg kicks, outer ring rear-leg Front / Round / Side / Back, past the dashed ring for head height. The choice is remembered.</li>
          <li>Hold Guard · Dash · Punch · ⇄ switch stance · Body/Head chip · ◎ lock-on · ❚❚ pause · drag anywhere else to orbit the camera.</li>
        </ul>
      </section>
      <section>
        <GroupLabel>Touch — Classic</GroupLabel>
        <ul>
          <li>One button per technique, plus Guard, Dash, Body/Head, a Rear/Lead chip and ⇄. Opacity, size and left-handed layout are in Settings.</li>
        </ul>
      </section>
      <section>
        <GroupLabel>Gamepad</GroupLabel>
        <ul>
          <li>Left stick move · right stick camera · X punch · A front · B round · Y side · RB back · D-pad ↑ → ← lead-leg kicks</li>
          <li>LB guard · RT head target · LT dash · R3 switch stance · Start pause. In menus: D-pad to move, A to select, B to go back.</li>
        </ul>
      </section>
    </div>
  );
}
