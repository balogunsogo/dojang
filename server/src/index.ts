import { DurableObject } from 'cloudflare:workers';

/**
 * One Durable Object per room code. It holds at most two WebSockets (host and
 * guest), forwards every message from one to the other, and adds a few
 * system messages: { t: 'hello' | 'peer' | 'error' }.
 *
 * Players try a direct WebRTC connection first (signalled through here); if
 * that fails, game traffic is relayed through this socket instead.
 */
export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
}

const INVITE_MS = 30 * 60 * 1000; // a new guest can join for 30 minutes
const GRACE_MS = 2 * 60 * 1000; // the room survives the host leaving for 2 minutes

interface Meta {
  created: number;
  hostId: string;
  guestId: string | null;
  v: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([A-Z0-9]{4,8})$/);
    if (!m) return new Response(url.pathname === '/' ? 'dojang-net ok' : 'not found', { status: url.pathname === '/' ? 200 : 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
};

export class Room extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const q = new URL(req.url).searchParams;
    const role = q.get('role') === 'host' ? 'host' : 'guest';
    const id = (q.get('id') ?? '').slice(0, 64);
    const v = (q.get('v') ?? '').slice(0, 32);
    const [client, server] = Object.values(new WebSocketPair());
    const fail = (code: string) => {
      server.accept();
      server.send(JSON.stringify({ t: 'error', code }));
      server.close(4000, code);
      return new Response(null, { status: 101, webSocket: client });
    };
    if (!id) return fail('bad-request');
    let meta = await this.ctx.storage.get<Meta>('meta');
    const now = Date.now();
    if (role === 'host') {
      if (meta && meta.hostId !== id) return fail('taken');
      if (!meta) {
        meta = { created: now, hostId: id, guestId: null, v };
        await this.ctx.storage.put('meta', meta);
      }
    } else {
      if (!meta) return fail('not-found');
      if (meta.v !== v) return fail('version');
      if (meta.guestId && meta.guestId !== id) return fail('full');
      if (!meta.guestId && now - meta.created > INVITE_MS) return fail('expired');
      if (!meta.guestId) {
        meta.guestId = id;
        await this.ctx.storage.put('meta', meta);
      }
    }
    // A reconnect replaces the old socket for that role.
    for (const old of this.ctx.getWebSockets(role)) old.close(4001, 'replaced');
    this.ctx.acceptWebSocket(server, [role]);
    const other = role === 'host' ? 'guest' : 'host';
    const peer = this.ctx.getWebSockets(other).length > 0;
    server.send(JSON.stringify({ t: 'hello', role, peer }));
    this.sendTo(other, JSON.stringify({ t: 'peer', present: true }));
    if (role === 'host') await this.ctx.storage.deleteAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  private sendTo(role: string, msg: string) {
    for (const ws of this.ctx.getWebSockets(role)) {
      try {
        ws.send(msg);
      } catch {
        /* closing */
      }
    }
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    const role = this.ctx.getTags(ws)[0];
    if (typeof msg === 'string' && msg.length < 64000) this.sendTo(role === 'host' ? 'guest' : 'host', msg);
  }

  async webSocketClose(ws: WebSocket, code: number) {
    const role = this.ctx.getTags(ws)[0];
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye');
    } catch {
      /* already closed */
    }
    const stillThere = this.ctx.getWebSockets(role).some((s) => s !== ws);
    if (stillThere) return; // replaced by a reconnect
    this.sendTo(role === 'host' ? 'guest' : 'host', JSON.stringify({ t: 'peer', present: false }));
    if (role === 'host') await this.ctx.storage.setAlarm(Date.now() + GRACE_MS);
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws, 1011);
  }

  /** The host did not come back: close the room and forget it. */
  async alarm() {
    if (this.ctx.getWebSockets('host').length > 0) return;
    this.sendTo('guest', JSON.stringify({ t: 'error', code: 'host-left' }));
    for (const ws of this.ctx.getWebSockets()) ws.close(4002, 'host-left');
    await this.ctx.storage.deleteAll();
  }
}
