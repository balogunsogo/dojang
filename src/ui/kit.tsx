/**
 * DOJANG UI kit: the small set of primitives from the approved design
 * system (docs/DESIGN_SYSTEM.md). Every non-gameplay screen is built from
 * these; there are deliberately no cards, chips, badges or eyebrow labels.
 */
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { audio } from '../game/audio/AudioEngine';
import { BELT_COLORS } from '../game/render/characterFactory';
import { hintKey, noteGamepad, useInputDevice } from '../game/input/device';
import { isTouchDevice } from '../game/render/quality';

/* ── Wordmark & title ─────────────────────────────────────────────── */
export function Wordmark({ as: Tag = 'h1' }: { as?: 'h1' | 'div' }) {
  return (
    <Tag className="wordmark" aria-label="Dojang">
      <span aria-hidden>DOJANG</span>
      <span className="ko" lang="ko" aria-hidden>
        도장
      </span>
    </Tag>
  );
}

/* ── Menu list with one shared "current" index (pointer, keys, gamepad) ── */
export interface MenuEntry {
  id: string;
  label: string;
  description?: string;
  tier?: 1 | 2;
  disabled?: boolean;
  testid?: string;
  onSelect(): void;
}

/**
 * Vertical menu. Arrow keys move the current item (wrapping), Enter/Space
 * activate, hover and focus follow the same index. The description shows
 * under the current item only.
 */
export function Menu({ items, label, initial = 0, autoFocus = true, className = '' }: { items: MenuEntry[]; label: string; initial?: number; autoFocus?: boolean; className?: string }) {
  const [cur, setCur] = useState(initial);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const uid = useId();
  const move = (d: number) => {
    let n = cur;
    for (let i = 0; i < items.length; i++) {
      n = (n + d + items.length) % items.length;
      if (!items[n].disabled) break;
    }
    setCur(n);
    audio.nav();
    refs.current[n]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
    }
  };
  useEffect(() => {
    if (autoFocus && !isTouchDevice()) refs.current[initial]?.focus({ preventScroll: true });
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  let lastTier = items[0]?.tier ?? 1;
  return (
    <nav className={`menu-list ${className}`} aria-label={label} onKeyDown={onKey}>
      <ul>
        {items.map((it, i) => {
          const gap = (it.tier ?? 1) !== lastTier;
          lastTier = it.tier ?? 1;
          const descId = `${uid}-${i}`;
          return (
            <li key={it.id} className={gap ? 'tier-gap' : ''}>
              <button
                ref={(el) => {
                  refs.current[i] = el;
                }}
                className={`menu-item t${it.tier ?? 1} ${i === cur ? 'current' : ''}`}
                aria-current={i === cur ? 'true' : undefined}
                aria-describedby={i === cur && it.description ? descId : undefined}
                disabled={it.disabled}
                onPointerEnter={() => !it.disabled && setCur(i)}
                onFocus={() => setCur(i)}
                onClick={() => {
                  audio.confirm();
                  it.onSelect();
                }}
                data-testid={it.testid}
              >
                <span className="label">{it.label}</span>
                {it.description && (
                  <span className="desc" id={descId}>
                    {it.description}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ── Actions ──────────────────────────────────────────────────────── */
/** Key hint on a button, shown as the matching controller button when a gamepad is in use. */
function HintKey({ k }: { k?: string }) {
  const dev = useInputDevice();
  const label = k ? hintKey(k, dev) : null;
  if (!label) return null;
  return (
    <kbd className={`hint-key ${dev.device === 'gamepad' ? `pad pad-${dev.pad}` : ''}`} aria-hidden>
      {label}
    </kbd>
  );
}

export function PrimaryButton({ children, hint, onClick, testid, autoFocus, disabled }: { children: ReactNode; hint?: string; onClick(): void; testid?: string; autoFocus?: boolean; disabled?: boolean }) {
  return (
    <button className="btn-primary" onClick={onClick} data-testid={testid} autoFocus={autoFocus} disabled={disabled}>
      <span>{children}</span>
      <HintKey k={hint} />
    </button>
  );
}

export function QuietButton({ children, hint, onClick, testid, className = '' }: { children: ReactNode; hint?: string; onClick(): void; testid?: string; className?: string }) {
  return (
    <button className={`btn-quiet ${className}`} onClick={onClick} data-testid={testid}>
      <span>{children}</span>
      <HintKey k={hint} />
    </button>
  );
}

export function BackButton({ onClick, label = 'Menu' }: { onClick(): void; label?: string }) {
  return (
    <button
      className="btn-back"
      onClick={() => {
        audio.back();
        onClick();
      }}
      aria-label={`Back to ${label.toLowerCase()}`} data-testid="menu-back">
      <span aria-hidden>←</span> {label}
    </button>
  );
}

/* ── Segmented control (radiogroup; arrows move) ──────────────────── */
export function Segmented<T extends string | number>({ value, options, onChange, label, testid, small }: { value: T; options: [T, ReactNode][]; onChange(v: T): void; label: string; testid?: string; small?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, options.findIndex(([v]) => v === value));
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (idx + d + options.length) % options.length;
    onChange(options[n][0]);
    refs.current[n]?.focus();
  };
  return (
    <div className={`segmented ${small ? 'small' : ''}`} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map(([v, text], i) => (
        <button
          key={String(v)}
          ref={(el) => {
            refs.current[i] = el;
          }}
          role="radio"
          aria-checked={value === v}
          tabIndex={value === v ? 0 : -1}
          className={value === v ? 'on' : ''}
          onClick={() => {
            audio.click();
            onChange(v);
          }}
          data-testid={testid ? `${testid}-${v}` : undefined}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/* ── Option row (single-select, native radio underneath) ──────────── */
export function OptionRow({ name, group, checked, onSelect, title, description, marker, testid }: { name?: string; group: string; checked: boolean; onSelect(): void; title: ReactNode; description?: ReactNode; marker?: ReactNode; testid?: string }) {
  return (
    <label className={`option-row ${checked ? 'on' : ''}`} data-testid={testid}>
      <input
        type="radio"
        name={group}
        value={name}
        checked={checked}
        onChange={() => {
          audio.click();
          onSelect();
        }}
      />
      {marker && <span className="marker">{marker}</span>}
      <span className="text">
        <span className="name">{title}</span>
        {description && <span className="desc">{description}</span>}
      </span>
      <span className="radio" aria-hidden />
    </label>
  );
}

/** Arrow keys inside a radio group move between rows (native radios do this; this keeps it for mixed content). */
export function OptionGroup({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`option-group ${className}`} role="radiogroup" aria-label={label}>
      {children}
    </div>
  );
}

/* ── Belt marker & corner tag ─────────────────────────────────────── */
export function BeltMarker({ belt, label = true, className = '' }: { belt: keyof typeof BELT_COLORS; label?: boolean; className?: string }) {
  return (
    <span className={`belt-marker ${className}`}>
      <i style={{ background: BELT_COLORS[belt] }} aria-hidden />
      {label && <span>{belt[0].toUpperCase() + belt.slice(1)} belt</span>}
    </span>
  );
}

export function CornerTag({ corner, name }: { corner: 'chung' | 'hong'; name: string }) {
  return <span className={`corner-tag ${corner}`}>{name}</span>;
}

/* ── Setting rows ─────────────────────────────────────────────────── */
export function SettingToggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="setting-row toggle">
      <span className="text">
        <span className="name">{label}</span>
        {hint && <span className="desc">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden />
    </label>
  );
}

export function SettingSlider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange(v: number): void; format(v: number): string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="setting-row slider">
      <span className="name">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} style={{ ['--pct' as string]: `${pct}%` }} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{format(value)}</output>
    </label>
  );
}

export function SettingChoice<T extends string | number>(props: { label: string; value: T; options: [T, ReactNode][]; onChange(v: T): void; testid?: string }) {
  return (
    <div className="setting-row choice">
      <span className="name">{props.label}</span>
      <Segmented small label={props.label} value={props.value} options={props.options} onChange={props.onChange} testid={props.testid} />
    </div>
  );
}

export function SettingLink({ label, onClick, testid }: { label: string; onClick(): void; testid?: string }) {
  return (
    <button className="setting-row link" onClick={onClick} data-testid={testid}>
      <span className="name">{label}</span>
      <span aria-hidden>→</span>
    </button>
  );
}

/* ── Info: input hints (hidden on touch, controller buttons on a gamepad) ── */
export function Hints({ items }: { items: [string, string][] }) {
  const dev = useInputDevice();
  if (dev.device !== 'gamepad' && (dev.device === 'touch' || isTouchDevice())) return null;
  return (
    <p className="hints" aria-hidden data-testid="hints">
      {items.map(([k, v]) => (
        <span key={k + v}>
          <kbd className={dev.device === 'gamepad' ? `pad pad-${dev.pad}` : undefined}>{hintKey(k, dev) ?? k}</kbd> {v}
        </span>
      ))}
    </p>
  );
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return <h2 className="group-label">{children}</h2>;
}

/* ── Screen shell: back, title, scrolling body, pinned footer ─────── */
export function ScreenShell({ title, context, onBack, backLabel, children, footer, className = '', titleId }: { title: ReactNode; context?: ReactNode; onBack?: () => void; backLabel?: string; children: ReactNode; footer?: ReactNode; className?: string; titleId?: string }) {
  // Esc goes back and Enter confirms the primary action, as the hints say.
  useEffect(() => {
    const k = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape' && onBack) onBack();
      if (e.key === 'Enter') {
        const a = document.activeElement as HTMLElement | null;
        const onControl = a && a !== document.body && (a.tagName === 'BUTTON' || (a instanceof HTMLInputElement && a.type !== 'radio') || a.tagName === 'SELECT');
        if (!onControl) {
          const p = document.querySelector<HTMLButtonElement>('.screen .btn-primary:not(:disabled)');
          if (p) {
            e.preventDefault();
            p.click();
          }
        }
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onBack]);
  return (
    <section className={`screen ${className}`} aria-labelledby={titleId}>
      <header className="screen-head">
        {onBack && <BackButton onClick={onBack} label={backLabel} />}
        {context && <p className="context">{context}</p>}
        <h1 className="title" id={titleId}>
          {title}
        </h1>
      </header>
      <div className="screen-body">{children}</div>
      {footer && <footer className="screen-foot">{footer}</footer>}
    </section>
  );
}

/* ── Gamepad: D-pad / stick moves focus, A activates, B goes back ─── */
export function useGamepadNav(onBack?: () => void) {
  useEffect(() => {
    let raf = 0;
    let prev: Record<string, boolean> = {};
    let repeatAt = 0;
    const focusables = () =>
      Array.from(document.querySelectorAll<HTMLElement>('.menu-root button:not(:disabled), .menu-root input:not(:disabled), .overlay button:not(:disabled), .overlay input:not(:disabled)')).filter(
        (el) => el.offsetParent !== null && el.tabIndex >= 0,
      );
    const step = (d: number) => {
      const a = document.activeElement as HTMLElement | null;
      // Inside a menu list, reuse its own arrow handling.
      if (a?.closest('.menu-list')) {
        a.dispatchEvent(new KeyboardEvent('keydown', { key: d > 0 ? 'ArrowDown' : 'ArrowUp', bubbles: true }));
        return;
      }
      const f = focusables();
      const i = a ? f.indexOf(a) : -1;
      f[(i + d + f.length) % f.length]?.focus();
    };
    const side = (d: number) => {
      const a = document.activeElement as HTMLElement | null;
      if (a instanceof HTMLInputElement && a.type === 'range') {
        const s = Number(a.step) || 1;
        const v = Math.min(Number(a.max), Math.max(Number(a.min), Number(a.value) + d * s));
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(a, String(v));
        a.dispatchEvent(new Event('input', { bubbles: true }));
      } else a?.dispatchEvent(new KeyboardEvent('keydown', { key: d > 0 ? 'ArrowRight' : 'ArrowLeft', bubbles: true }));
    };
    const poll = (t: number) => {
      raf = requestAnimationFrame(poll);
      const pad = navigator.getGamepads?.().find((g) => g);
      if (!pad) return;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (pad.buttons.some((b) => b.pressed) || Math.abs(pad.axes[0] ?? 0) > 0.6 || Math.abs(pad.axes[1] ?? 0) > 0.6) noteGamepad(pad);
      const now: Record<string, boolean> = {
        up: !!pad.buttons[12]?.pressed || ay < -0.6,
        down: !!pad.buttons[13]?.pressed || ay > 0.6,
        left: !!pad.buttons[14]?.pressed || ax < -0.6,
        right: !!pad.buttons[15]?.pressed || ax > 0.6,
        a: !!pad.buttons[0]?.pressed,
        b: !!pad.buttons[1]?.pressed,
      };
      const edge = (k: string) => now[k] && (!prev[k] || t > repeatAt);
      if (edge('up') || edge('down')) {
        step(now.down ? 1 : -1);
        repeatAt = t + (prev.up || prev.down ? 140 : 380);
      } else if (edge('left') || edge('right')) {
        side(now.right ? 1 : -1);
        repeatAt = t + (prev.left || prev.right ? 140 : 380);
      }
      if (now.a && !prev.a) (document.activeElement as HTMLElement | null)?.click();
      if (now.b && !prev.b) onBack?.();
      prev = now;
    };
    const start = () => {
      if (!raf) raf = requestAnimationFrame(poll);
    };
    // Only poll once a pad is connected.
    window.addEventListener('gamepadconnected', start);
    if (navigator.getGamepads?.().some((g) => g)) start();
    return () => {
      window.removeEventListener('gamepadconnected', start);
      cancelAnimationFrame(raf);
    };
  }, [onBack]);
}
