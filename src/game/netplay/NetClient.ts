import type { NetLink } from '../GameSession';
import type { Belt } from '../progress/progress';
import type { CharacterId } from '../render/characterFactory';
import type { NetMsg } from './Rollback';

/** Multiplayer server (a Cloudflare Worker). Online play is hidden when unset. */
export const NET_URL = (import.meta.env.VITE_NET_URL as string | undefined)?.replace(/\/$/, '') ?? '';
/** Both players must run the same build (the simulation must match exactly). */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/** Online play is behind a flag until it has been tested: `?online=1` turns it on for this browser. */
export function onlineEnabled(): boolean {
  if (!NET_URL) return false;
  const q = new URLSearchParams(location.search);
  try {
    if (q.get('online') === '1') localStorage.setItem('dojang.online', '1');
    if (q.get('online') === '0') localStorage.removeItem('dojang.online');
    return import.meta.env.VITE_ONLINE === '1' || q.has('room') || localStorage.getItem('dojang.online') === '1';
  } catch {
    return import.meta.env.VITE_ONLINE === '1' || q.has('room') || q.get('online') === '1';
  }
}

export type InputKind = 'keyboard' | 'touch' | 'gamepad';
export interface PeerInfo {
  nick: string;
  fighter: CharacterId;
  belt: Belt;
  ready: boolean;
  input: InputKind;
}
export interface MatchCfg {
  mode: 'arcade' | 'competitive';
  round: 60 | 90 | 120;
}

export interface NetState {
  status: 'idle' | 'connecting' | 'lobby' | 'countdown' | 'playing' | 'error';
  role: 'host' | 'guest' | null;
  code: string | null;
  error: string | null;
  /** The other player is connected to the room. */
  peerPresent: boolean;
  /** When the other player dropped (ms timestamp), null while connected. */
  peerGoneAt: number | null;
  /** Our own connection to the server is down and retrying. */
  reconnecting: boolean;
  me: PeerInfo;
  peer: PeerInfo | null;
  cfg: MatchCfg;
  /** Round-trip time (ms). */
  ping: number | null;
  /** Direct peer-to-peer link open (otherwise traffic is relayed). */
  direct: boolean;
  /** Corner the host fights in (swaps on every rematch). */
  hostCorner: 0 | 1;
  countdownEnd: number | null;
  rematch: { me: boolean; peer: boolean };
  /** Bumps on every new match start. */
  matchId: number;
}

type Msg =
  | { t: 'hello'; role: string; peer: boolean }
  | { t: 'peer'; present: boolean }
  | { t: 'error'; code: string }
  | { t: 'info'; p: PeerInfo }
  | { t: 'cfg'; c: MatchCfg }
  | { t: 'start'; hostCorner: 0 | 1; c: MatchCfg; id: number }
  | { t: 'rtc'; sdp?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit }
  /** Game traffic, tagged with the match it belongs to. */
  | { t: 'g'; m: NetMsg; id: number }
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number }
  | { t: 'rematch'; on: boolean }
  | { t: 'lobby' }
  | { t: 'bye' };

export const ERRORS: Record<string, string> = {
  'not-found': 'That room doesn’t exist (or has closed). Ask your friend for a new link.',
  full: 'Someone else already joined that room.',
  expired: 'That invite has expired. Ask your friend for a new link.',
  version: 'You and your friend are on different versions of DOJANG. Both of you, please refresh the page.',
  taken: 'That room code is in use. Try again.',
  'host-left': 'The host left, so the room closed.',
  'peer-left': 'Your friend left.',
  network: 'Can’t reach the multiplayer server. Check your connection and try again.',
};

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ICE: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const COUNTDOWN_MS = 3000;
const GIVE_UP_MS = 2 * 60 * 1000;

/** Stable per browser, so a friend who closes the tab can rejoin with the same link. */
function clientId() {
  try {
    let id = localStorage.getItem('dojang.netid');
    if (!id) localStorage.setItem('dojang.netid', (id = crypto.randomUUID()));
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/**
 * Lobby and connection for one online room. The server pairs the two
 * players and relays messages; game traffic uses a direct WebRTC data
 * channel when one can be opened, and falls back to the relay otherwise.
 */
export class NetClient {
  state: NetState;
  private subs = new Set<() => void>();
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private pingTimer = 0;
  private retry = 0;
  private retryTimer = 0;
  private closedByUs = false;
  private droppedAt = 0;
  /** The running match's link (GameSession sets onMessage). */
  readonly link: NetLink = { send: (m) => this.sendFast({ t: 'g', m, id: this.state.matchId }), onMessage: null };

  constructor() {
    this.state = this.fresh();
  }

  private fresh(): NetState {
    return {
      status: 'idle',
      role: null,
      code: null,
      error: null,
      peerPresent: false,
      peerGoneAt: null,
      reconnecting: false,
      me: { nick: '', fighter: 'jae', belt: 'white', ready: false, input: 'keyboard' },
      peer: null,
      cfg: { mode: 'arcade', round: 90 },
      ping: null,
      direct: false,
      hostCorner: 0,
      countdownEnd: null,
      rematch: { me: false, peer: false },
      matchId: 0,
    };
  }

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };
  getState = () => this.state;
  private set(p: Partial<NetState>) {
    this.state = { ...this.state, ...p };
    for (const fn of this.subs) fn();
  }

  // ── Public actions ──────────────────────────────────────────────────
  host(me: PeerInfo, cfg: MatchCfg) {
    let code = '';
    for (let i = 0; i < 6; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    this.open('host', code, me, cfg);
  }

  join(code: string, me: PeerInfo) {
    this.open('guest', code.toUpperCase().replace(/[^A-Z0-9]/g, ''), me, this.state.cfg);
  }

  inviteLink() {
    const u = new URL(location.href);
    u.search = `?room=${this.state.code}`;
    u.hash = '';
    return u.toString();
  }

  updateMe(p: Partial<PeerInfo>) {
    this.set({ me: { ...this.state.me, ...p } });
    this.sendWs({ t: 'info', p: this.state.me });
    this.maybeStart();
  }

  setCfg(c: Partial<MatchCfg>) {
    if (this.state.role !== 'host') return;
    this.set({ cfg: { ...this.state.cfg, ...c } });
    this.sendWs({ t: 'cfg', c: this.state.cfg });
  }

  /** After a match: ask for a rematch (starts when both agree; corners swap). */
  requestRematch() {
    this.set({ rematch: { ...this.state.rematch, me: true } });
    this.sendWs({ t: 'rematch', on: true });
    this.maybeRematch();
  }

  backToLobby() {
    this.sendWs({ t: 'lobby' });
    this.toLobby();
  }

  leave() {
    this.closedByUs = true;
    this.sendWs({ t: 'bye' });
    this.teardown();
    this.state = this.fresh();
    this.set({});
  }

  /** The match ended early (the other player stayed away too long). */
  forfeit() {
    this.leave();
    this.set({ status: 'error', error: ERRORS['peer-left'] });
  }

  // ── Connection ──────────────────────────────────────────────────────
  private open(role: 'host' | 'guest', code: string, me: PeerInfo, cfg: MatchCfg) {
    this.teardown();
    this.closedByUs = false;
    this.retry = 0;
    this.set({ ...this.fresh(), status: 'connecting', role, code, me: { ...me, ready: false }, cfg });
    this.connect();
    this.pingTimer = window.setInterval(() => this.sendFast({ t: 'ping', ts: performance.now() }), 1000);
  }

  private connect() {
    const { role, code } = this.state;
    const url = `${NET_URL.replace(/^http/, 'ws')}/room/${code}?role=${role}&id=${clientId()}&v=${encodeURIComponent(BUILD_ID)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (e) => {
      try {
        this.onMsg(JSON.parse(e.data as string) as Msg);
      } catch {
        /* ignore malformed */
      }
    };
    ws.onopen = () => {
      this.retry = 0;
      this.droppedAt = 0;
    };
    ws.onclose = () => {
      if (this.ws !== ws || this.closedByUs || this.state.status === 'error') return;
      // Retry with backoff; give up after two minutes.
      if (!this.droppedAt) this.droppedAt = Date.now();
      if (Date.now() - this.droppedAt > GIVE_UP_MS || (this.state.status === 'connecting' && this.retry >= 2)) {
        this.fail('network');
        return;
      }
      this.set({ reconnecting: true });
      this.retryTimer = window.setTimeout(() => this.connect(), Math.min(8000, 1000 * 2 ** this.retry++));
    };
  }

  private fail(code: string) {
    this.closedByUs = true;
    this.teardown();
    this.set({ status: 'error', error: ERRORS[code] ?? code, reconnecting: false });
  }

  private teardown() {
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.retryTimer);
    this.closeRtc();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private sendWs(m: Msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Game traffic and pings: the direct channel when open, else the relay. */
  private sendFast(m: Msg) {
    if (this.dc?.readyState === 'open') {
      try {
        this.dc.send(JSON.stringify(m));
        return;
      } catch {
        /* fall back to the relay */
      }
    }
    this.sendWs(m);
  }

  private onMsg(m: Msg) {
    const s = this.state;
    switch (m.t) {
      case 'hello':
        this.set({ status: s.status === 'connecting' ? 'lobby' : s.status, reconnecting: false });
        this.sendWs({ t: 'info', p: this.state.me });
        if (s.role === 'host') this.sendWs({ t: 'cfg', c: s.cfg });
        if (m.peer) this.peerArrived();
        break;
      case 'peer':
        if (m.present) this.peerArrived();
        else {
          this.closeRtc();
          this.set({ peerPresent: false, peerGoneAt: Date.now(), ping: null, ...(s.status === 'lobby' || s.status === 'countdown' ? { status: 'lobby', countdownEnd: null, me: { ...s.me, ready: false } } : {}) });
        }
        break;
      case 'error':
        this.fail(m.code);
        break;
      case 'info':
        this.set({ peer: m.p });
        this.maybeStart();
        break;
      case 'cfg':
        if (s.role === 'guest') this.set({ cfg: m.c });
        break;
      case 'start':
        if (s.role === 'guest') this.begin(m.hostCorner, m.c, m.id);
        break;
      case 'rtc':
        void this.onRtc(m);
        break;
      case 'g':
        // Only the current match's traffic: on a rematch the previous match's
        // last messages (still in flight, or from a peer that has not switched
        // yet) would otherwise reach the new rollback and stall it.
        if (m.id === s.matchId) this.link.onMessage?.(m.m);
        break;
      case 'ping':
        this.sendFast({ t: 'pong', ts: m.ts });
        break;
      case 'pong':
        this.set({ ping: Math.round(performance.now() - m.ts) });
        break;
      case 'rematch':
        this.set({ rematch: { ...s.rematch, peer: m.on } });
        this.maybeRematch();
        break;
      case 'lobby':
        if (s.status === 'playing' || s.status === 'countdown') this.toLobby();
        break;
      case 'bye':
        if (s.role === 'guest') this.fail('host-left');
        else {
          this.closeRtc();
          this.set({ peer: null, peerPresent: false, peerGoneAt: null, status: s.status === 'playing' ? s.status : 'lobby', me: { ...s.me, ready: false } });
        }
        break;
    }
  }

  private peerArrived() {
    this.set({ peerPresent: true, peerGoneAt: null });
    this.sendWs({ t: 'info', p: this.state.me });
    if (this.state.role === 'host') void this.startRtc();
  }

  private toLobby() {
    const me = { ...this.state.me, ready: false };
    this.set({ status: 'lobby', countdownEnd: null, rematch: { me: false, peer: false }, me });
    this.sendWs({ t: 'info', p: me });
  }

  /** Host: start when both players are ready. */
  private maybeStart() {
    const s = this.state;
    if (s.role !== 'host' || s.status !== 'lobby' || !s.peerPresent || !s.me.ready || !s.peer?.ready) return;
    const id = s.matchId + 1;
    this.sendWs({ t: 'start', hostCorner: s.hostCorner, c: s.cfg, id });
    this.begin(s.hostCorner, s.cfg, id);
  }

  private maybeRematch() {
    const s = this.state;
    if (s.role !== 'host' || !s.rematch.me || !s.rematch.peer) return;
    const hostCorner = (1 - s.hostCorner) as 0 | 1;
    const id = s.matchId + 1;
    this.sendWs({ t: 'start', hostCorner, c: s.cfg, id });
    this.begin(hostCorner, s.cfg, id);
  }

  /** Start a match after the countdown. The host numbers matches, so both sides agree on the id. */
  private begin(hostCorner: 0 | 1, cfg: MatchCfg, id: number) {
    this.set({ status: 'countdown', hostCorner, cfg, countdownEnd: Date.now() + COUNTDOWN_MS, rematch: { me: false, peer: false } });
    window.setTimeout(() => {
      if (this.state.status === 'countdown') this.set({ status: 'playing', countdownEnd: null, matchId: id });
    }, COUNTDOWN_MS);
  }

  // ── WebRTC (direct link) ────────────────────────────────────────────
  private newPc() {
    this.closeRtc();
    const pc = new RTCPeerConnection({ iceServers: ICE });
    this.pc = pc;
    pc.onicecandidate = (e) => e.candidate && this.sendWs({ t: 'rtc', cand: e.candidate.toJSON() });
    pc.ondatachannel = (e) => this.useDc(e.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.set({ direct: false });
    };
    return pc;
  }

  private useDc(dc: RTCDataChannel) {
    this.dc = dc;
    dc.onopen = () => this.set({ direct: true });
    dc.onclose = () => this.set({ direct: false });
    dc.onmessage = (e) => {
      try {
        this.onMsg(JSON.parse(e.data as string) as Msg);
      } catch {
        /* ignore */
      }
    };
  }

  /** `?relay=1` skips the direct link (testing the fallback). */
  private noRtc() {
    return typeof RTCPeerConnection === 'undefined' || new URLSearchParams(location.search).get('relay') === '1';
  }

  private async startRtc() {
    if (this.noRtc()) return;
    try {
      const pc = this.newPc();
      this.useDc(pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 }));
      await pc.setLocalDescription(await pc.createOffer());
      this.sendWs({ t: 'rtc', sdp: pc.localDescription!.toJSON() });
    } catch {
      /* the relay still works */
    }
  }

  private async onRtc(m: { sdp?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit }) {
    if (this.noRtc()) return;
    try {
      if (m.sdp?.type === 'offer') {
        const pc = this.newPc();
        await pc.setRemoteDescription(m.sdp);
        await pc.setLocalDescription(await pc.createAnswer());
        this.sendWs({ t: 'rtc', sdp: pc.localDescription!.toJSON() });
      } else if (m.sdp?.type === 'answer') await this.pc?.setRemoteDescription(m.sdp);
      else if (m.cand) await this.pc?.addIceCandidate(m.cand);
    } catch {
      /* the relay still works */
    }
  }

  private closeRtc() {
    if (this.dc) this.dc.onclose = this.dc.onmessage = null;
    this.dc?.close();
    this.pc?.close();
    this.dc = null;
    this.pc = null;
    if (this.state?.direct) this.set({ direct: false });
  }
}

export const net = new NetClient();
