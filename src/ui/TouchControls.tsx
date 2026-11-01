import { type PointerEvent as RPointerEvent, useRef, useState } from 'react';
import type { InputManager } from '../game/input/InputManager';
import { useGameStore } from '../store/useGameStore';

/**
 * Classic touch layout (landscape):
 *  - left half: floating movement joystick (appears where the thumb lands)
 *  - right cluster: five techniques, hold-to-guard, dash, head/body toggle
 *  - any other touch on the right half orbits the camera
 * Every control tracks its own pointerId, so simultaneous touches
 * (move + guard + kick + camera) work independently.
 */
export function TouchControls({ input }: { input: InputManager }) {
  const t = input.touch;
  const stick = useRef<{ id: number; ox: number; oy: number } | null>(null);
  const cam = useRef<{ id: number; x: number; y: number } | null>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const [high, setHigh] = useState(false);
  const setPaused = useGameStore((s) => s.setPaused);
  const R = 56;

  const stickDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (stick.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    stick.current = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
    const b = baseRef.current!;
    b.style.left = `${e.clientX - R}px`;
    b.style.top = `${e.clientY - R}px`;
    b.classList.add('active');
  };
  const stickMove = (e: RPointerEvent<HTMLDivElement>) => {
    const s = stick.current;
    if (!s || s.id !== e.pointerId) return;
    let dx = e.clientX - s.ox;
    let dy = e.clientY - s.oy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      // Drag the base along so the stick never "runs out" (floating joystick).
      const k = (d - R) / d;
      s.ox += dx * k;
      s.oy += dy * k;
      dx = e.clientX - s.ox;
      dy = e.clientY - s.oy;
      const b = baseRef.current!;
      b.style.left = `${s.ox - R}px`;
      b.style.top = `${s.oy - R}px`;
    }
    const nx = dx / R;
    const ny = -dy / R;
    const mag = Math.hypot(nx, ny);
    const dead = 0.12;
    const scale = mag < dead ? 0 : Math.min(1, (mag - dead) / (1 - dead)) / (mag || 1);
    t.moveX = nx * scale;
    t.moveY = ny * scale;
    knobRef.current!.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const stickUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (stick.current?.id !== e.pointerId) return;
    stick.current = null;
    t.moveX = t.moveY = 0;
    knobRef.current!.style.transform = '';
    baseRef.current!.classList.remove('active');
  };

  const camDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (cam.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    cam.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const camMove = (e: RPointerEvent<HTMLDivElement>) => {
    const c = cam.current;
    if (!c || c.id !== e.pointerId) return;
    t.camYaw -= (e.clientX - c.x) * 0.008;
    t.camPitch += (e.clientY - c.y) * 0.005;
    c.x = e.clientX;
    c.y = e.clientY;
  };
  const camUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (cam.current?.id === e.pointerId) cam.current = null;
  };

  const toggleHigh = () => {
    const v = !high;
    setHigh(v);
    t.high = v;
  };

  return (
    <div className="touch" onContextMenu={(e) => e.preventDefault()} data-testid="touch-controls">
      <div className="zone-stick" onPointerDown={stickDown} onPointerMove={stickMove} onPointerUp={stickUp} onPointerCancel={stickUp} data-testid="stick-zone">
        <div className="stick-base" ref={baseRef}>
          <div className="stick-knob" ref={knobRef} />
        </div>
        <div className="stick-hint">Move</div>
      </div>
      <div className="zone-cam" onPointerDown={camDown} onPointerMove={camMove} onPointerUp={camUp} onPointerCancel={camUp} />
      <div className="cluster">
        <TapButton cls="b-punch" label="Punch" sub="Jireugi" onTap={() => input.press('punch')} />
        <TapButton cls="b-front" label="Front" sub="Ap" onTap={() => input.press('front')} />
        <TapButton cls="b-round big" label="Round" sub="Dollyeo" onTap={() => input.press('round')} />
        <TapButton cls="b-side" label="Side" sub="Yeop" onTap={() => input.press('side')} />
        <TapButton cls="b-back" label="Back" sub="Dwi" onTap={() => input.press('back')} />
        <HoldButton cls="b-guard" label="Guard" onChange={(v) => (t.guard = v)} />
        <TapButton cls="b-dash" label="Dash" onTap={() => input.press('dash')} />
        <TapButton cls={`b-high ${high ? 'on' : ''}`} label={high ? 'Head' : 'Body'} sub="target" onTap={toggleHigh} />
      </div>
      <div className="touch-top">
        <button className="tbtn" onPointerDown={() => input.press('lock')}>
          ◎
        </button>
        <button className="tbtn" onPointerDown={() => input.press('switch')}>
          ⇄
        </button>
        <button className="tbtn" onPointerDown={() => setPaused(true)}>
          ❚❚
        </button>
      </div>
    </div>
  );
}

function TapButton({ cls, label, sub, onTap }: { cls: string; label: string; sub?: string; onTap: () => void }) {
  const [down, setDown] = useState(false);
  return (
    <div
      className={`tb ${cls} ${down ? 'down' : ''}`}
      role="button"
      aria-label={label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDown(true);
        onTap();
        navigator.vibrate?.(8);
      }}
      onPointerUp={() => setDown(false)}
      onPointerCancel={() => setDown(false)}
    >
      <span className="l">{label}</span>
      {sub && <span className="s">{sub}</span>}
    </div>
  );
}

function HoldButton({ cls, label, onChange }: { cls: string; label: string; onChange: (v: boolean) => void }) {
  const [down, setDown] = useState(false);
  const set = (v: boolean) => {
    setDown(v);
    onChange(v);
  };
  return (
    <div
      className={`tb ${cls} ${down ? 'down' : ''}`}
      role="button"
      aria-label={label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
    >
      <span className="l">{label}</span>
      <span className="s">hold</span>
    </div>
  );
}
