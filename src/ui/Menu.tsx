import { useState } from 'react';
import type { Difficulty } from '../game/ai/AIController';
import { audio } from '../game/audio/AudioEngine';
import { isTouchDevice, type QualitySetting } from '../game/render/quality';
import { useGameStore } from '../store/useGameStore';

const DIFFS: { id: Difficulty; label: string; note: string }[] = [
  { id: 'easy', label: 'White belt', note: 'Slow reactions, rarely guards' },
  { id: 'normal', label: 'Red belt', note: 'Guards, counters, uses range' },
  { id: 'hard', label: 'Black belt', note: 'Fast reads, punishes whiffs' },
];

export function Menu() {
  const startMatch = useGameStore((s) => s.startMatch);
  const settings = useGameStore((s) => s.settings);
  const update = useGameStore((s) => s.updateSettings);
  const [panel, setPanel] = useState<'main' | 'controls' | 'settings'>('main');

  const start = (d: Difficulty) => {
    audio.unlock();
    audio.setVolume(settings.volume);
    if (isTouchDevice() && document.documentElement.requestFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => undefined);
    }
    startMatch(d);
  };

  return (
    <div className="menu">
      <div className="menu-inner">
        <h1>
          DOJANG <span className="hangul">도장</span>
        </h1>
        <p className="tag">Taekwondo sparring</p>
        {panel === 'main' && (
          <>
            <section>
              <h3>Spar vs AI — Arcade rules</h3>
              <div className="diffs">
                {DIFFS.map((d) => (
                  <button key={d.id} className="diff" onClick={() => start(d.id)} data-testid={`start-${d.id}`}>
                    <strong>{d.label}</strong>
                    <span>{d.note}</span>
                  </button>
                ))}
              </div>
            </section>
            <section className="row">
              <button disabled title="Planned for Phase 4">
                Training — coming soon
              </button>
              <button disabled title="Planned for Phase 2">
                Competitive (WT points) — coming soon
              </button>
            </section>
            <section className="row">
              <button onClick={() => setPanel('controls')}>Controls</button>
              <button onClick={() => setPanel('settings')}>Settings</button>
            </section>
          </>
        )}
        {panel === 'controls' && (
          <section className="controls-help">
            <h3>Keyboard</h3>
            <ul>
              <li><kbd>W A S D</kbd> footwork (camera-relative) · <kbd>Shift</kbd> dash (no direction = back-step)</li>
              <li><kbd>J</kbd> punch · <kbd>K</kbd> front kick · <kbd>L</kbd> roundhouse · <kbd>U</kbd> side kick · <kbd>I</kbd> back kick</li>
              <li>Hold <kbd>E</kbd> to aim kicks at the head · hold <kbd>Space</kbd> to guard</li>
              <li><kbd>Q</kbd> switch stance · <kbd>Tab</kbd> lock-on · mouse drag / wheel camera · <kbd>Esc</kbd> pause</li>
            </ul>
            <h3>Touch</h3>
            <ul>
              <li>Left thumb anywhere on the left half: floating joystick</li>
              <li>Right cluster: techniques, hold Guard, Dash, Head/Body toggle</li>
              <li>Drag on empty space on the right to orbit the camera</li>
            </ul>
            <h3>Gamepad</h3>
            <ul>
              <li>Left stick move · right stick camera · X punch · A front · B round · Y side · RB back</li>
              <li>LB guard · RT head target · LT dash · R3 switch stance · Start pause</li>
            </ul>
            <button onClick={() => setPanel('main')}>Back</button>
          </section>
        )}
        {panel === 'settings' && (
          <section className="settings">
            <label>
              Graphics
              <select value={settings.quality} onChange={(e) => update({ quality: e.target.value as QualitySetting })}>
                <option value="auto">Auto</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label>
              Volume
              <input type="range" min={0} max={1} step={0.05} value={settings.volume} onChange={(e) => update({ volume: Number(e.target.value) })} />
            </label>
            <label>
              <input type="checkbox" checked={settings.showPerf} onChange={(e) => update({ showPerf: e.target.checked })} /> Performance overlay
            </label>
            <label>
              <input type="checkbox" checked={settings.forceTouch} onChange={(e) => update({ forceTouch: e.target.checked })} /> Always show touch controls
            </label>
            <p className="muted">Touch control mode: Classic buttons. Hybrid gestures arrive in Phase 3.</p>
            <button onClick={() => setPanel('main')}>Back</button>
          </section>
        )}
        <p className="foot muted">
          A game, not an official grading or rules reference. Character: CC0 Quaternius mannequin. Techniques: original procedural animation.
        </p>
      </div>
    </div>
  );
}
