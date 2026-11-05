import { useSyncExternalStore } from 'react';

/**
 * The input device in use right now (keyboard/mouse, touch or gamepad) and
 * the controller family, so prompts match what the player is holding.
 */
export type Device = 'keyboard' | 'touch' | 'gamepad';
export type PadStyle = 'xbox' | 'playstation' | 'nintendo';
/** Buttons by their position in the standard gamepad layout (Xbox names). */
export type PadButton = 'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'LT' | 'RT' | 'L3' | 'R3' | 'Start' | 'Select';

export const PAD_LABELS: Record<PadStyle, Record<PadButton, string>> = {
  xbox: { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', L3: 'LS', R3: 'RS', Start: 'Menu', Select: 'View' },
  playstation: { A: '✕', B: '○', X: '□', Y: '△', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', L3: 'L3', R3: 'R3', Start: 'Options', Select: 'Create' },
  // Nintendo pads report the bottom button first, which is labelled B.
  nintendo: { A: 'B', B: 'A', X: 'Y', Y: 'X', LB: 'L', RB: 'R', LT: 'ZL', RT: 'ZR', L3: 'L stick', R3: 'R stick', Start: '+', Select: '−' },
};
export const PAD_NAME: Record<PadStyle, string> = { xbox: 'Xbox', playstation: 'PlayStation', nintendo: 'Nintendo' };

/** Controller family from the browser's gamepad id (vendor 054c = Sony, 057e = Nintendo). */
export function padStyleFromId(id: string): PadStyle {
  const s = id.toLowerCase();
  if (/054c|dualsense|dualshock|playstation|ps4|ps5|wireless controller/.test(s)) return 'playstation';
  if (/057e|nintendo|pro controller|joy-con/.test(s)) return 'nintendo';
  return 'xbox';
}

interface State {
  device: Device;
  pad: PadStyle;
}
let state: State = { device: 'keyboard', pad: 'xbox' };
const subs = new Set<() => void>();
let lastPadId = '';

function set(p: Partial<State>) {
  if ((p.device ?? state.device) === state.device && (p.pad ?? state.pad) === state.pad) return;
  state = { ...state, ...p };
  for (const fn of subs) fn();
}

export const getDevice = () => state;
export const subscribeDevice = (fn: () => void) => {
  subs.add(fn);
  return () => subs.delete(fn);
};
export const useInputDevice = () => useSyncExternalStore(subscribeDevice, getDevice);

export function noteDevice(device: Device) {
  set({ device });
}

/** A gamepad was used (called from the polling loops). */
export function noteGamepad(pad: Gamepad) {
  if (pad.id !== lastPadId) {
    lastPadId = pad.id;
    set({ device: 'gamepad', pad: padStyleFromId(pad.id) });
  } else set({ device: 'gamepad' });
}

/** Label of a button on the controller in use (e.g. "✕" on PlayStation). */
export const padLabel = (b: PadButton) => PAD_LABELS[state.pad][b];

/**
 * A keyboard hint ("Enter", "Esc", "↑↓") translated for the device in use.
 * Returns null on touch, where hints are hidden.
 */
export function hintKey(k: string, s: State = state): string | null {
  if (s.device === 'gamepad') {
    const L = PAD_LABELS[s.pad];
    if (k === 'Enter') return L.A;
    if (k === 'Esc') return L.B;
    if (k === '↑↓') return 'D-pad ↑↓';
    if (k === '←→') return 'D-pad ←→';
    return k;
  }
  return s.device === 'touch' ? null : k;
}

/** Track keyboard/mouse and touch from DOM events; gamepads report via noteGamepad. */
export function trackInputDevice(isTouch: boolean) {
  if (isTouch) state = { ...state, device: 'touch' };
  window.addEventListener('keydown', (e) => !e.repeat && noteDevice('keyboard'), true);
  window.addEventListener('pointerdown', (e) => noteDevice(e.pointerType === 'touch' || e.pointerType === 'pen' ? 'touch' : 'keyboard'), true);
  window.addEventListener('gamepadconnected', (e) => {
    lastPadId = e.gamepad.id;
    set({ pad: padStyleFromId(e.gamepad.id) });
  });
}
