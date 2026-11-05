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

  // The room went back to the lobby or closed.
  useEffect(() => {
    if (s.status === 'lobby' || s.status === 'error' || s.status === 'idle') useGameStore.getState().toMenu('online');
  }, [s.status]);

  const over = useGameStore((st) => st.hud?.phase === 'match-over');
  const waiting = !over && s.status === 'playing' && (silent > 1500 || !s.peerPresent);
  const since = s.peerGoneAt && !s.peerPresent ? (Date.now() - s.peerGoneAt) / 1000 : (silent - 1500) / 1000;
  const left = Math.max(0, Math.ceil(WAIT_S - since));
  useEffect(() => {
    if (waiting && left === 0) net.forfeit();
  }, [waiting, left]);

  const q = s.ping === null ? 'none' : s.ping <= 80 ? 'good' : s.ping <= 150 ? 'ok' : 'bad';
  const countdown = s.countdownEnd ? Math.max(1, Math.ceil((s.countdownEnd - Date.now()) / 1000)) : null;
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
    </>
  );
}
