# Multiplayer: play a friend

Home › **Play a friend** offers two modes:
- **Same device (couch):** two players on one screen.
- **Online:** invite a friend with a link.

Online stays hidden behind a feature flag until it has been tested on real devices (see "Turning online on").

## How it works

**Couch:**
- Player 1 uses the usual keyboard keys without the arrows. Player 2 uses the arrows plus numpad 1–5 (or `, . / ; '` on keyboards without a numpad).
- **Gamepads:** with two gamepads, each player gets one. With one gamepad, player 2 uses it and player 1 the keyboard.
- **Shared camera:** both players' movement is relative to the screen.
- **Progress:** only player 1's progress is saved.

**Online (rollback netcode, GGPO-style):**
- **Lockstep inputs:** the simulation is a deterministic 60 Hz fixed step. Each tick, the only thing the players exchange is their input, packed into a single integer.
- **Hiding lag:** inputs are delayed by 2 ticks. If the opponent's input hasn't arrived, the game predicts it ("still holding the same thing") and keeps going.
- **Rollback:** when the real input differs from the prediction, the game rewinds to that tick and re-simulates. It predicts at most 8 ticks ahead, then briefly waits.
- **Sounds and effects:** these play once, even when a tick is re-simulated. The result only counts once every input behind it is confirmed.
- **Desync check:** every second, both players compare a checksum of the confirmed state. On a mismatch, the guest silently loads the host's state.
- **Determinism:** trigonometry in the simulation goes through `src/game/dmath.ts` (plain arithmetic, so it is identical on every browser and CPU).
- **Connection:** a direct WebRTC data channel (unordered, no retransmits) using free STUN servers. If that can't open, game traffic is relayed through the server's WebSocket.
- **Lobby:**
  - The host picks the rules and round length.
  - Each player picks a fighter (mirror matches are allowed).
  - When both players press Ready, a 3-second countdown starts.
  - Rematch needs both players, and corners swap each time.
  - Nicknames are stored only on the device.
- **Disconnects:**
  - **In a match:** the opponent gets 15 seconds ("Waiting for opponent…"), then the match ends as a forfeit, which is not recorded.
  - **In the lobby:** the room waits 2 minutes for a host who dropped.
- **Version check:** both players must run the same build. Otherwise the guest is told to refresh.
- **Progress:** an online or couch win counts toward the Yellow belt's "win a match" only. Green still needs a win against the AI.

| Piece | File |
|---|---|
| Deterministic math | `src/game/dmath.ts` |
| Snapshot / restore, checksum | `src/game/netplay/snapshot.ts` |
| Input packing | `src/game/netplay/inputCodec.ts` |
| Rollback controller | `src/game/netplay/Rollback.ts` |
| Lobby, WebRTC and relay client | `src/game/netplay/NetClient.ts` |
| Menus and lobby UI | `src/ui/Friend.tsx`, `src/ui/OnlineStatus.tsx` |
| Server (Cloudflare Worker + Durable Object) | `server/` |

## The server (Cloudflare, free plan)

`server/` is a small Worker. It runs one Durable Object per room code, which:
- holds the host's and the guest's WebSockets;
- forwards messages between them;
- rejects a second guest, a wrong version, or an expired invite (30 minutes);
- cleans up two minutes after the host leaves.

It stores nothing else.

**Cost: $0 on the Workers Free plan** for friends-only play:
- **Requests:** a lobby is a handful of requests.
- **Relay fallback:** even a fully relayed 10-minute match is roughly 3–4k billed requests (WebSocket messages count 20:1), against a daily allowance of 100k.
- **Direct matches:** a direct match barely touches the server at all.

### One-time setup

You need Node 18+ and your Cloudflare account.

1. Install the server's tools:

```bash
cd server
npm install
```

2. Log in to Cloudflare (this opens a browser):

```bash
npx wrangler login
```

3. Deploy:

```bash
npx wrangler deploy
```

   It prints a URL such as `https://dojang-net.<your-subdomain>.workers.dev`.
   - **Check:** opening it in a browser should say `dojang-net ok`.
   - **First deploy only:** if Wrangler asks you to choose a workers.dev subdomain, pick any name.
4. In **Vercel** › the dojang project › Settings › Environment Variables, add:
   - `VITE_NET_URL` = the URL from step 3, for Production and Preview.
   - Optional: `VITE_ONLINE` = `1` to show Online to everyone. Leave it unset while testing.
5. Redeploy the site, since Vercel bakes the variables in at build time.

### Turning online on

- **While testing:** open the site once with `?online=1`. The flag is remembered in that browser, and `?online=0` turns it off again. Invite links (`?room=…`) always work.
- **When it's ready:** set `VITE_ONLINE=1` in Vercel to show Online to everyone.

### Optional: a TURN server

- **Why:** a few networks (some mobile carriers, strict corporate Wi-Fi) block direct connections. Those players still get matches through the WebSocket relay, just with more lag.
- **Better option:** Cloudflare Realtime TURN, with 1,000 GB/month free. It would need a TURN key and a small token endpoint, which is not built yet. The relay is good enough for a start.

## Testing

**Unit tests:**
- `npx vitest run tests/rollback.test.ts`: two simulated players over a link with 50–110 ms latency, jitter, reordering and 10% loss, playing 40 seconds of Competitive. Both end in the identical state, and a forced desync is corrected.
- `tests/dmath.test.ts` checks the deterministic maths against `Math`.

**Local two-browser check:**

1. Start the server locally:

```bash
cd server && npx wrangler dev
```

2. Build the site against it:

```bash
VITE_NET_URL=http://127.0.0.1:8787 VITE_ONLINE=1 npx vite build
```

3. Serve the build:

```bash
npx vite preview --port 4180
```

4. Run the check:

```bash
node scripts/dev/online-check.mjs
```

   Add `--relay` to force the relay fallback. It drives two headless browsers through:
   - create a room, join by link, Ready, and play;
   - both screens agree on positions, health and stamina;
   - no desyncs;
   - Esc does not pause;
   - the "waiting for opponent" banner appears when the guest drops.

**Couch:** `node scripts/dev/couch-check.mjs <url>`.

**Still needed (UAT):**
- real devices on different networks (phone ↔ desktop, Wi-Fi ↔ mobile data);
- how it feels at real latencies;
- Safari/iOS WebRTC;
- two physical gamepads.

## Known limitations

- **Hidden tab:** a hidden or backgrounded tab stops sending inputs. After 15 seconds the opponent wins by forfeit, and nothing is recorded.
- **Rare ghost cues:** a sound or effect from a mispredicted moment can occasionally play and then be "taken back" by the rollback. Hits and points are always correct.
- **Refresh mid-match:** a player who refreshes mid-match returns to the lobby. The match itself can't be resumed.
- **No extras:** no spectators, chat, emotes or replays (by design).
