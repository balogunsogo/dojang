import { type ActionState, type AttackKind, emptyActions, LEAD_OF, type TargetHeight } from './actions';

/**
 * Shared, mutable input written by the on-screen touch controls (React
 * components write here directly, not through React state, to avoid
 * re-renders on every pointer move).
 */
export interface TouchInput {
  moveX: number;
  moveY: number;
  guard: boolean;
  high: boolean;
  camYaw: number;
  camPitch: number;
  camZoom: number;
}

export const KEY_BINDINGS: Record<string, string> = {
  KeyW: 'up',
  KeyA: 'left',
  KeyS: 'down',
  KeyD: 'right',
  ArrowUp: 'up',
  ArrowLeft: 'left',
  ArrowDown: 'down',
  ArrowRight: 'right',
  KeyJ: 'punch',
  KeyK: 'front',
  KeyL: 'round',
  KeyU: 'side',
  KeyI: 'back',
  Space: 'guard',
  ShiftLeft: 'dash',
  ShiftRight: 'dash',
  KeyQ: 'switch',
  KeyE: 'high',
  KeyF: 'lead',
  Tab: 'lock',
  Escape: 'pause',
  KeyP: 'pause',
};

const ATTACK_KEYS: Record<string, AttackKind> = {
  punch: 'punch',
  front: 'front',
  round: 'round',
  side: 'side',
  back: 'back',
  leadFront: 'leadFront',
  leadRound: 'leadRound',
  leadSide: 'leadSide',
};

// Standard gamepad mapping.
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, R3: 11, UP: 12, LEFT: 14, RIGHT: 15 };

/**
 * Merges keyboard, mouse, touch and gamepad into one ActionState. Edge events
 * (attack, dash, ...) are latched until the simulation consumes them so a
 * press is never lost when a render frame runs zero sim ticks.
 */
export class InputManager {
  readonly touch: TouchInput = { moveX: 0, moveY: 0, guard: false, high: false, camYaw: 0, camPitch: 0, camZoom: 0 };
  private held = new Set<string>();
  private edges: Partial<ActionState> = {};
  private padPrev: boolean[] = [];
  private mouse = { down: false, x: 0, y: 0, dYaw: 0, dPitch: 0, zoom: 0 };
  private listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];
  /** Last device that produced input; the UI uses it to show/hide touch controls. */
  lastDevice: 'keyboard' | 'touch' | 'gamepad' = 'keyboard';

  attach(canvas: HTMLElement) {
    const on = (t: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn, opts);
      this.listeners.push([t, type, fn, opts]);
    };
    on(window, 'keydown', ((e: KeyboardEvent) => this.onKey(e, true)) as EventListener);
    on(window, 'keyup', ((e: KeyboardEvent) => this.onKey(e, false)) as EventListener);
    on(window, 'blur', () => this.held.clear());
    on(canvas, 'pointerdown', ((e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse.down = true;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    }) as EventListener);
    on(window, 'pointermove', ((e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !this.mouse.down) return;
      this.mouse.dYaw -= (e.clientX - this.mouse.x) * 0.006;
      this.mouse.dPitch += (e.clientY - this.mouse.y) * 0.004;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    }) as EventListener);
    on(window, 'pointerup', ((e: PointerEvent) => {
      if (e.pointerType === 'mouse') this.mouse.down = false;
    }) as EventListener);
    on(canvas, 'wheel', ((e: WheelEvent) => {
      this.mouse.zoom += Math.sign(e.deltaY) * 0.4;
      e.preventDefault();
    }) as EventListener, { passive: false });
  }

  detach() {
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
    this.listeners = [];
    this.held.clear();
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const action = KEY_BINDINGS[e.code];
    if (!action) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    e.preventDefault();
    this.lastDevice = 'keyboard';
    if (down) {
      if (!e.repeat) this.press(action);
      this.held.add(action);
    } else this.held.delete(action);
  }

  /** Latch a discrete action (also used by touch buttons and tests). */
  press(action: string, height?: TargetHeight) {
    let atk = ATTACK_KEYS[action];
    if (atk) {
      // Holding the lead modifier (F) turns a rear-leg kick into its lead-leg version.
      if (this.held.has('lead') && LEAD_OF[atk]) atk = LEAD_OF[atk]!;
      this.edges.attack = atk;
      if (height) this.edges.attackHeight = height;
      return;
    }
    if (action === 'dash') this.edges.dash = true;
    else if (action === 'switch') this.edges.switchStance = true;
    else if (action === 'lock') this.edges.toggleLock = true;
    else if (action === 'pause') this.edges.pause = true;
  }

  /** Read the merged state for this frame. Edges stay latched until consumeEdges(). */
  poll(): ActionState {
    const s = emptyActions();
    const h = this.held;
    let mx = (h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0);
    let my = (h.has('up') ? 1 : 0) - (h.has('down') ? 1 : 0);
    s.guard = h.has('guard');
    s.high = h.has('high');
    s.lead = h.has('lead');
    // Touch.
    const t = this.touch;
    if (Math.hypot(t.moveX, t.moveY) > 0.01) {
      mx = t.moveX;
      my = t.moveY;
      this.lastDevice = 'touch';
    }
    s.guard ||= t.guard;
    s.high ||= t.high;
    s.camYaw = t.camYaw + this.mouse.dYaw;
    s.camPitch = t.camPitch + this.mouse.dPitch;
    s.camZoom = t.camZoom + this.mouse.zoom;
    t.camYaw = t.camPitch = t.camZoom = 0;
    this.mouse.dYaw = this.mouse.dPitch = this.mouse.zoom = 0;
    // Gamepad.
    this.pollGamepad(s, (x, y) => {
      if (Math.hypot(x, y) > Math.hypot(mx, my)) {
        mx = x;
        my = y;
      }
    });
    const m = Math.hypot(mx, my);
    if (m > 1) {
      mx /= m;
      my /= m;
    }
    s.moveX = mx;
    s.moveY = my;
    Object.assign(s, this.edges);
    return s;
  }

  consumeEdges() {
    this.edges = {};
  }

  private pollGamepad(s: ActionState, setMove: (x: number, y: number) => void) {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    if (!pad) return;
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
    const lx = dz(pad.axes[0] ?? 0);
    const ly = dz(pad.axes[1] ?? 0);
    const rx = dz(pad.axes[2] ?? 0);
    const ry = dz(pad.axes[3] ?? 0);
    const btn = (i: number) => !!pad.buttons[i]?.pressed;
    const edge = (i: number) => btn(i) && !this.padPrev[i];
    if (lx || ly || rx || ry || pad.buttons.some((b) => b.pressed)) this.lastDevice = 'gamepad';
    setMove(lx, -ly);
    s.camYaw -= rx * 0.05;
    s.camPitch += ry * 0.03;
    s.guard ||= btn(PAD.LB);
    s.high ||= btn(PAD.RT);
    if (edge(PAD.X)) this.press('punch');
    if (edge(PAD.A)) this.press('front');
    if (edge(PAD.B)) this.press('round');
    if (edge(PAD.Y)) this.press('side');
    if (edge(PAD.RB)) this.press('back');
    if (edge(PAD.UP)) this.press('leadFront');
    if (edge(PAD.RIGHT)) this.press('leadRound');
    if (edge(PAD.LEFT)) this.press('leadSide');
    if (edge(PAD.LT)) this.press('dash');
    if (edge(PAD.R3) || edge(PAD.SELECT)) this.press('switch');
    if (edge(PAD.START)) this.press('pause');
    this.padPrev = pad.buttons.map((b) => b.pressed);
    Object.assign(s, this.edges);
  }
}
