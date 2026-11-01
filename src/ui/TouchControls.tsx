import { type PointerEvent as RPointerEvent, type ReactNode, useRef, useState } from 'react';
import type { InputManager } from '../game/input/InputManager';
import { useGameStore } from '../store/useGameStore';
import { KICK_LABEL, pickWheel, WHEEL_HEAD_RADIUS, WHEEL_ITEMS, WHEEL_LEAD_EDGE, WHEEL_LEAD_RADIUS, WHEEL_RADIUS, type WheelKick, type WheelPick } from './wheel';

const HOLD_MS = 260;
const TAP_SLOP = 14;

/**
 * Touch controls. Two schemes share the joystick, camera area and top bar:
 *
 *  Compact (default): one Kick button that repeats the selected technique;
 *  drag from it (or hold) to open the technique wheel and release on a
 *  technique to select and throw it. Dragging past the outer ring throws it
 *  at head height. Guard, Dash, Punch, stance switch and a Head/Body chip
 *  sit around it.
 *
 *  Classic: one button per technique.
 *
 * Every control captures its own pointer, so simultaneous touches (stick,
 * guard, kick, camera) never steal from each other, and nothing outside a
 * control's own element reacts to its gesture.
 */
export function TouchControls({ input }: { input: InputManager }) {
  const t = input.touch;
  const scheme = useGameStore((s) => s.settings.controlScheme);
  const setPaused = useGameStore((s) => s.setPaused);
  const stick = useRef<{ id: number; ox: number; oy: number } | null>(null);
  const cam = useRef<{ id: number; x: number; y: number } | null>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const [high, setHigh] = useState(false);
  const [lead, setLead] = useState(false);
  const R = 52;

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
      // Floating joystick: the base follows the thumb so it never runs out.
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
    <div className={`touch scheme-${scheme}`} onContextMenu={(e) => e.preventDefault()} data-testid="touch-controls">
      <div className="zone-cam" onPointerDown={camDown} onPointerMove={camMove} onPointerUp={camUp} onPointerCancel={camUp} data-testid="cam-zone" />
      <div className="zone-stick" onPointerDown={stickDown} onPointerMove={stickMove} onPointerUp={stickUp} onPointerCancel={stickUp} data-testid="stick-zone">
        <div className="stick-base" ref={baseRef}>
          <div className="stick-knob" ref={knobRef} />
        </div>
      </div>
      {scheme === 'compact' ? (
        <CompactCluster input={input} high={high} toggleHigh={toggleHigh} />
      ) : (
        <div className="cluster classic">
          <TapButton cls="b-punch" label="Punch" onTap={() => input.press('punch')} />
          <TapButton cls="b-front" label={lead ? 'L·Front' : 'Front'} aria="Front" onTap={() => input.press(lead ? 'leadFront' : 'front')} />
          <TapButton cls="b-round big" label={lead ? 'L·Round' : 'Round'} aria="Round" onTap={() => input.press(lead ? 'leadRound' : 'round')} />
          <TapButton cls="b-side" label={lead ? 'L·Side' : 'Side'} aria="Side" onTap={() => input.press(lead ? 'leadSide' : 'side')} />
          <TapButton cls={`b-lead chip ${lead ? 'on' : ''}`} label={lead ? 'Lead' : 'Rear'} aria="Kicking leg" onTap={() => setLead((v) => !v)} />
          <TapButton cls="b-back" label="Back" onTap={() => input.press('back')} />
          <HoldButton cls="b-guard" label="Guard" onChange={(v) => (t.guard = v)} />
          <TapButton cls="b-dash" label="Dash" onTap={() => input.press('dash')} />
          <TapButton cls={`b-high chip ${high ? 'on' : ''}`} label={high ? 'Head' : 'Body'} onTap={toggleHigh} />
          <TapButton cls="b-switch" label="⇄" aria="Switch stance" onTap={() => input.press('switch')} />
        </div>
      )}
      <button className="tbtn t-pause" aria-label="Pause" onPointerDown={() => setPaused(true)}>
        ❚❚
      </button>
      <button className="tbtn t-lock" aria-label="Lock-on" onPointerDown={() => input.press('lock')}>
        ◎
      </button>
    </div>
  );
}

function CompactCluster({ input, high, toggleHigh }: { input: InputManager; high: boolean; toggleHigh: () => void }) {
  const t = input.touch;
  const selected = useGameStore((s) => s.settings.selectedKick);
  const update = useGameStore((s) => s.updateSettings);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<WheelPick | null>(null);
  const [down, setDown] = useState(false);
  const g = useRef<{ id: number; x: number; y: number; t0: number; moved: boolean; timer: number } | null>(null);

  const fire = (kind: WheelKick, head: boolean) => {
    input.press(kind, head || high ? 'head' : 'body');
    navigator.vibrate?.(8);
  };
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (g.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    const timer = window.setTimeout(() => setOpen(true), HOLD_MS);
    g.current = { id: e.pointerId, x: r.left + r.width / 2, y: r.top + r.height / 2, t0: performance.now(), moved: false, timer };
    setDown(true);
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.moved && Math.hypot(dx, dy) > TAP_SLOP) {
      s.moved = true;
      setOpen(true);
    }
    if (s.moved || open) setPick(pickWheel(dx, dy));
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    window.clearTimeout(s.timer);
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const p = pickWheel(dx, dy);
    const wasOpen = open || s.moved;
    g.current = null;
    setDown(false);
    setOpen(false);
    setPick(null);
    if (!wasOpen) {
      // Quick tap: repeat the selected technique.
      fire(selected, false);
    } else if (p) {
      if (p.kind !== selected) update({ selectedKick: p.kind });
      fire(p.kind, p.head);
    } else if (Math.hypot(dx, dy) < TAP_SLOP) {
      // Long press released in place: still throw the selected technique.
      fire(selected, false);
    }
  };
  const onCancel = () => {
    if (g.current) window.clearTimeout(g.current.timer);
    g.current = null;
    setDown(false);
    setOpen(false);
    setPick(null);
  };
  const [label, ko] = KICK_LABEL[selected];

  return (
    <div className={`cluster compact ${open ? 'wheel-open' : ''}`}>
      {open && (
        <div className="wheel" data-testid="kick-wheel">
          <div className="wheel-ring head" style={{ width: WHEEL_HEAD_RADIUS * 2, height: WHEEL_HEAD_RADIUS * 2 }} />
          <div className="wheel-ring lead" style={{ width: WHEEL_LEAD_EDGE * 2, height: WHEEL_LEAD_EDGE * 2 }} />
          {WHEEL_ITEMS.map((it) => {
            const a = (it.angle * Math.PI) / 180;
            const on = pick?.kind === it.kind;
            return (
              <div
                key={it.kind}
                className={`wheel-item ring-${it.ring} ${on ? 'on' : ''} ${on && pick?.head ? 'head' : ''} ${it.kind === selected ? 'sel' : ''}`}
                data-kind={it.kind}
                style={{ transform: `translate(${Math.cos(a) * (it.ring === 'lead' ? WHEEL_LEAD_RADIUS : WHEEL_RADIUS)}px, ${-Math.sin(a) * (it.ring === 'lead' ? WHEEL_LEAD_RADIUS : WHEEL_RADIUS)}px)` }}
              >
                <span className="l">{it.label}</span>
                <span className="s">{on && pick?.head ? 'HEAD' : it.korean}</span>
              </div>
            );
          })}
        </div>
      )}
      <div
        className={`kick-main ${down ? 'down' : ''} ${high ? 'head' : ''}`}
        role="button"
        aria-label="Kick"
        data-testid="kick-main"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
      >
        <span className="l">{label}</span>
        <span className="s">{ko}</span>
        <span className="arc" aria-hidden />
      </div>
      <HoldButton cls="b-guard" label="Guard" onChange={(v) => (t.guard = v)} />
      <TapButton cls="b-dash" label="Dash" onTap={() => input.press('dash')} />
      <TapButton cls="b-punch" label="Punch" onTap={() => input.press('punch')} />
      <TapButton cls="b-switch" label="⇄" aria="Switch stance" onTap={() => input.press('switch')} />
      <TapButton cls={`b-high chip ${high ? 'on' : ''}`} label={high ? 'Head' : 'Body'} aria="Target height" onTap={toggleHigh} />
    </div>
  );
}

function TapButton({ cls, label, aria, onTap }: { cls: string; label: ReactNode; aria?: string; onTap: () => void }) {
  const [down, setDown] = useState(false);
  return (
    <div
      className={`tb ${cls} ${down ? 'down' : ''}`}
      role="button"
      aria-label={aria ?? String(label)}
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
    </div>
  );
}
