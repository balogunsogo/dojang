import { useEffect, useState } from 'react';
import type { GameSession } from '../game/GameSession';
import { net } from '../game/netplay/NetClient';
import { useGameStore } from '../store/useGameStore';
import { useNet } from './Friend';

const WAIT_S = 15;

/**
 * Online match chrome: the connection dot, the "waiting for opponent"
 * countdown (forfeit after 15 s), the rematch countdown, and the way back
 * to the lobby when the room leaves the match.
 */
export function OnlineStatus({ session }: { session: GameSession }) {
  const s = useNet();
  const [silent, setSilent] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSilent(session.netSilentMs), 250);
    return () => window.clearInterval(id);
  }, [session]);

  // Online pause is shared: the local pause flag (Esc, pause button, app
  // switch) pauses both players, and the other player's pause shows here.
  const localPaused = useGameStore((st) => st.paused);
  const over0 = useGameStore((st) => st.hud?.phase === 'match-over');
  useEffect(() => {
    if (localPaused && !s.pause) {
      if (s.status === 'playing' && !over0) net.pauseMatch();
      if (!net.state.pause) useGameStore.getState().setPaused(false); // could not pause (match over, not playing)
    } else if (!localPaused && s.pause) net.resumeMatch();
    // Only the local flag drives this; the net state is read fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPaused]);
  useEffect(() => {
    const want = !!s.pause;
    if (useGameStore.getState().paused !== want) useGameStore.getState().setPaused(want);
  }, [s.pause]);

  // The room went back to the lobby or closed.
  useEffect(() => {
    if (s.status === 'lobby' || s.status === 'error' || s.status === 'idle') useGameStore.getState().toMenu('online');
  }, [s.status]);

  const over = useGameStore((st) => st.hud?.phase === 'match-over');
  // A shared pause is not a disconnect (a backgrounded phone stops sending while paused).
  const holding = !!s.pause || (s.resumeAt !== null && s.resumeAt > Date.now());
  const waiting = !over && !holding && s.status === 'playing' && (silent > 1500 || !s.peerPresent);
  const since = s.peerGoneAt && !s.peerPresent ? (Date.now() - s.peerGoneAt) / 1000 : (silent - 1500) / 1000;
  const left = Math.max(0, Math.ceil(WAIT_S - since));
  useEffect(() => {
    if (waiting && left === 0) net.forfeit();
  }, [waiting, left]);

  const q = s.ping === null ? 'none' : s.ping <= 80 ? 'good' : s.ping <= 150 ? 'ok' : 'bad';
  const countdown = s.countdownEnd ? Math.max(1, Math.ceil((s.countdownEnd - Date.now()) / 1000)) : null;
  const resuming = !s.pause && s.resumeAt && s.resumeAt > Date.now() ? Math.max(1, Math.ceil((s.resumeAt - Date.now()) / 1000)) : null;
  return (
    <>
      <div className={`net-dot ping-${q}`} title={`${s.ping ?? '—'} ms · ${s.direct ? 'direct' : 'relay'}`} data-testid="net-dot">
        <i aria-hidden />
        <span>{s.ping ?? '—'} ms</span>
      </div>
      {waiting && (
        <div className="net-banner" role="status" data-testid="net-waiting">
          Waiting for opponent… {left}s
        </div>
      )}
      {countdown && (
        <div className="net-banner" role="status">
          Rematch in {countdown}
        </div>
      )}
      {resuming && (
        <div className="net-banner" role="status" data-testid="net-resuming">
          Resuming in {resuming}
        </div>
      )}
    </>
  );
}
