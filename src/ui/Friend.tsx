import { useEffect, useState, useSyncExternalStore } from 'react';
import { type InputKind, type MatchCfg, net, onlineEnabled } from '../game/netplay/NetClient';
import { loadFighterAsset, CHARACTERS, type CharacterId } from '../game/render/characterFactory';
import { isTouchDevice } from '../game/render/quality';
import { type MenuPanel, useGameStore } from '../store/useGameStore';
import { BeltMarker, GroupLabel, OptionGroup, OptionRow, PrimaryButton, QuietButton, ScreenShell, Segmented } from './kit';

export const useNet = () => useSyncExternalStore(net.subscribe, net.getState);

const NICK_KEY = 'dojang.nick';
function loadNick() {
  try {
    return localStorage.getItem(NICK_KEY) ?? '';
  } catch {
    return '';
  }
}
function saveNick(n: string) {
  try {
    localStorage.setItem(NICK_KEY, n);
  } catch {
    /* ignore */
  }
}
const cleanNick = (n: string) => n.replace(/\s+/g, ' ').trim().slice(0, 16);

function inputKind(): InputKind {
  const pads = navigator.getGamepads?.() ?? [];
  if (Array.from(pads).some((p) => p?.connected)) return 'gamepad';
  return isTouchDevice() ? 'touch' : 'keyboard';
}
const INPUT_LABEL: Record<InputKind, string> = { keyboard: 'Keyboard', touch: 'Touch', gamepad: 'Gamepad' };

/** Invite link opened (`?room=CODE`): go straight to the join screen. */
export function roomFromUrl(): string | null {
  const c = new URLSearchParams(location.search).get('room');
  return c && onlineEnabled() ? c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) : null;
}
function clearRoomParam() {
  const u = new URL(location.href);
  if (!u.searchParams.has('room')) return;
  u.searchParams.delete('room');
  history.replaceState(null, '', u.toString());
}

function FighterPick({ value, onChange, group }: { value: CharacterId; onChange(id: CharacterId): void; group: string }) {
  return (
    <Segmented
      label="Fighter"
      testid={group}
      value={value}
      onChange={onChange}
      options={(Object.keys(CHARACTERS) as CharacterId[]).map((id) => [id, CHARACTERS[id].name])}
    />
  );
}

function RulesPick({ cfg, onChange }: { cfg: MatchCfg; onChange(c: Partial<MatchCfg>): void }) {
  return (
    <>
      <Segmented
        label="Rules"
        testid="friend-rules"
        value={cfg.mode}
        onChange={(mode) => onChange({ mode })}
        options={[
          ['arcade', 'Arcade'],
          ['competitive', 'Competitive'],
        ]}
      />
      {cfg.mode === 'competitive' && (
        <Segmented
          label="Round length"
          small
          value={cfg.round}
          onChange={(round) => onChange({ round })}
          options={[
            [60, '1:00'],
            [90, '1:30'],
            [120, '2:00'],
          ]}
        />
      )}
    </>
  );
}

/* ── Play a friend: same device or online ──────────────────────────── */
export function FriendSetup({ onBack, leave, go }: { onBack(): void; leave(fn: () => void): void; go(p: MenuPanel): void }) {
  const progress = useGameStore((s) => s.progress);
  const rounds = useGameStore((s) => s.settings.compRoundSeconds);
  const online = onlineEnabled();
  const [where, setWhere] = useState<'couch' | 'online'>('couch');
  const [cfg, setCfg] = useState<MatchCfg>({ mode: 'arcade', round: rounds });
  const [p2, setP2] = useState<CharacterId>(progress.fighter === 'jae' ? 'hana' : 'jae');
  const [nick, setNick] = useState(loadNick);
  const [code, setCode] = useState('');
  const me = () => ({ nick: cleanNick(nick) || 'Player', fighter: progress.fighter, belt: progress.belt, ready: false, input: inputKind() });

  const startCouch = () =>
    leave(() => {
      useGameStore.getState().updateSettings({ compRoundSeconds: cfg.round });
      useGameStore.getState().startVersus(
        {
          kind: 'local',
          characters: [progress.fighter, p2],
          belts: [progress.belt, 'white'],
          names: [`P1 · ${CHARACTERS[progress.fighter].short}`, `P2 · ${CHARACTERS[p2].short}`],
          me: 0,
        },
        cfg.mode,
      );
    });
  const host = () => {
    saveNick(cleanNick(nick));
    net.host(me(), cfg);
    go('online');
  };
  const join = () => {
    saveNick(cleanNick(nick));
    net.join(code, me());
    go('online');
  };

  return (
    <ScreenShell
      title="Play a friend"
      titleId="t-friend"
      onBack={onBack}
      footer={
        where === 'couch' ? (
          <PrimaryButton onClick={startCouch} hint="Enter" testid="start-couch">
            Start match
          </PrimaryButton>
        ) : (
          <PrimaryButton onClick={host} hint="Enter" testid="create-room">
            Create room
          </PrimaryButton>
        )
      }
    >
      {online && (
        <Segmented
          label="Where"
          testid="friend-where"
          value={where}
          onChange={(v) => setWhere(v)}
          options={[
            ['couch' as const, 'Same device'],
            ['online', 'Online'],
          ]}
        />
      )}
      <GroupLabel>Rules</GroupLabel>
      <RulesPick cfg={cfg} onChange={(c) => setCfg({ ...cfg, ...c })} />
      {where === 'couch' ? (
        <>
          <GroupLabel>Player 2 fighter</GroupLabel>
          <FighterPick value={p2} onChange={setP2} group="p2-fighter" />
          <p className="body-copy">
            Player 1 is <strong>{CHARACTERS[progress.fighter].name}</strong> in the blue corner (change it in Choose fighter). Only player 1’s progress is saved; a win counts toward the yellow belt.
          </p>
          <GroupLabel>Controls</GroupLabel>
          <ul className="caption couch-keys">
            <li>Two gamepads: one each.</li>
            <li>One gamepad: player 2 uses it, player 1 the keyboard.</li>
            <li>One keyboard: player 1 on WASD + J K L U I (Space guard, Shift dash, Q switch, E high); player 2 on the arrows + numpad 1–5 (0 guard, Enter dash, . switch, 6 high), or , . / ; ' without a numpad.</li>
          </ul>
        </>
      ) : (
        <>
          <GroupLabel>Your name</GroupLabel>
          <input className="text-input" aria-label="Your name" maxLength={16} placeholder="Nickname" value={nick} onChange={(e) => setNick(e.target.value)} data-testid="nick" />
          <p className="body-copy">Create a room and send your friend the link. You start as {CHARACTERS[progress.fighter].name} in the blue corner; corners swap on every rematch.</p>
          <GroupLabel>Have a code?</GroupLabel>
          <div className="row">
            <input className="text-input code" aria-label="Room code" maxLength={8} placeholder="ABC123" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} data-testid="join-code" />
            <QuietButton onClick={join} testid="join-room">
              Join
            </QuietButton>
          </div>
          <p className="caption">Online play connects your devices directly, which shares your IP address with your friend.</p>
        </>
      )}
    </ScreenShell>
  );
}

/* ── Online lobby ──────────────────────────────────────────────────── */
function PingDot({ ping, direct }: { ping: number | null; direct: boolean }) {
  const q = ping === null ? 'none' : ping <= 80 ? 'good' : ping <= 150 ? 'ok' : 'bad';
  return (
    <span className={`ping ping-${q}`} title={direct ? 'Direct connection' : 'Relayed connection'}>
      <i aria-hidden /> {ping === null ? '—' : `${ping} ms`}
      {ping !== null && !direct && ' · relay'}
    </span>
  );
}

export function OnlineLobby({ onBack }: { onBack(): void }) {
  const s = useNet();
  const progress = useGameStore((st) => st.progress);
  const pending = roomFromUrl();
  const [nick, setNick] = useState(loadNick);
  const [copied, setCopied] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    void loadFighterAsset(); // warm the fighter model while waiting
    const id = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, []);
  const leaveRoom = () => {
    net.leave();
    clearRoomParam();
    onBack();
  };

  // Invite link: ask for a name, then join.
  if (s.status === 'idle' && pending) {
    const go = () => {
      const n = cleanNick(nick) || 'Player';
      saveNick(n);
      net.join(pending, { nick: n, fighter: progress.fighter, belt: progress.belt, ready: false, input: inputKind() });
    };
    return (
      <ScreenShell
        title="Join a friend"
        titleId="t-join"
        onBack={leaveRoom}
        footer={
          <PrimaryButton onClick={go} hint="Enter" testid="join-confirm">
            Join room {pending}
          </PrimaryButton>
        }
      >
        <GroupLabel>Your name</GroupLabel>
        <input className="text-input" aria-label="Your name" maxLength={16} placeholder="Nickname" value={nick} onChange={(e) => setNick(e.target.value)} data-testid="nick" autoFocus />
        <p className="caption">Online play connects your devices directly, which shares your IP address with your friend.</p>
      </ScreenShell>
    );
  }

  if (s.status === 'idle' || s.status === 'error') {
    return (
      <ScreenShell title="Online" titleId="t-online" onBack={leaveRoom} footer={<PrimaryButton onClick={leaveRoom}>Back</PrimaryButton>}>
        <p className="feedback warn" role="alert" data-testid="net-error">
          {s.error ?? 'Not connected.'}
        </p>
      </ScreenShell>
    );
  }

  const host = s.role === 'host';
  const share = async () => {
    const url = net.inviteLink();
    try {
      if (navigator.share && isTouchDevice()) await navigator.share({ title: 'DOJANG', text: 'Spar with me in DOJANG', url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      /* cancelled */
    }
  };
  const peerGoneFor = s.peerGoneAt ? Math.round((Date.now() - s.peerGoneAt) / 1000) : 0;
  const countdown = s.countdownEnd ? Math.max(1, Math.ceil((s.countdownEnd - Date.now()) / 1000)) : null;
  const players = [
    { p: s.me, you: true },
    ...(s.peer && s.peerPresent ? [{ p: s.peer, you: false }] : []),
  ];

  return (
    <ScreenShell
      title={countdown ? `Starting in ${countdown}` : host ? 'Your room' : 'Room'}
      titleId="t-lobby"
      context={s.code ? `Room ${s.code}` : undefined}
      onBack={leaveRoom}
      backLabel="Leave"
      footer={
        s.status === 'connecting' ? (
          <p className="caption">Connecting…</p>
        ) : (
          <PrimaryButton onClick={() => net.updateMe({ ready: !s.me.ready })} hint="Enter" testid="ready" disabled={!s.peerPresent || !!countdown}>
            {s.me.ready ? 'Not ready' : 'Ready'}
          </PrimaryButton>
        )
      }
    >
      {s.reconnecting && <p className="feedback warn">Connection lost — reconnecting…</p>}
      {host && !s.peerPresent && (
        <>
          <p className="body-copy">Send this link to your friend. The room stays open for 30 minutes.</p>
          <p className="room-code" data-testid="room-code">
            {s.code}
          </p>
          <div className="row">
            <PrimaryButton onClick={share} testid="share-link">
              {copied ? 'Link copied' : isTouchDevice() && 'share' in navigator ? 'Share link' : 'Copy link'}
            </PrimaryButton>
          </div>
          {s.peerGoneAt ? <p className="caption">Your friend disconnected {peerGoneFor}s ago. Waiting for them to come back…</p> : <p className="caption">Waiting for your friend…</p>}
        </>
      )}
      {!host && !s.peerPresent && s.status !== 'connecting' && <p className="feedback warn">The host disconnected. Waiting up to 2 minutes for them to come back…</p>}
      <GroupLabel>Players</GroupLabel>
      <OptionGroup label="Players" className="lobby-players">
        {players.map(({ p, you }) => (
          <OptionRow
            key={you ? 'me' : 'peer'}
            group="players"
            checked={p.ready}
            onSelect={() => undefined}
            marker={<BeltMarker belt={p.belt} label={false} />}
            title={
              <>
                {p.nick || 'Player'} {you && <span className="muted">(you)</span>}
              </>
            }
            description={`${CHARACTERS[p.fighter].name} · ${INPUT_LABEL[p.input]} · ${p.ready ? 'Ready' : 'Not ready'}`}
          />
        ))}
      </OptionGroup>
      {s.peerPresent && (
        <p className="caption">
          Connection <PingDot ping={s.ping} direct={s.direct} />
          {s.ping !== null && s.ping > 150 && ' — a slow connection: expect some jumps.'}
        </p>
      )}
      <GroupLabel>Your fighter</GroupLabel>
      <FighterPick value={s.me.fighter} onChange={(fighter) => net.updateMe({ fighter, ready: false })} group="online-fighter" />
      <GroupLabel>Rules {host ? '' : '(set by the host)'}</GroupLabel>
      {host ? (
        <RulesPick cfg={s.cfg} onChange={(c) => net.setCfg(c)} />
      ) : (
        <p className="body-copy">
          {s.cfg.mode === 'competitive' ? `Competitive · ${s.cfg.round / 60 === 1 ? '1:00' : s.cfg.round === 90 ? '1:30' : '2:00'} rounds` : 'Arcade'}
        </p>
      )}
    </ScreenShell>
  );
}

/** Starts the online match when the room says so (from the menu or after a rematch). */
export function useOnlineMatchStarter() {
  const s = useNet();
  useEffect(() => {
    if (s.status !== 'playing' || !s.peer) return;
    const hostCorner = s.hostCorner;
    const me = (s.role === 'host' ? hostCorner : 1 - hostCorner) as 0 | 1;
    const mine = s.me;
    const theirs = s.peer;
    const byCorner = me === 0 ? [mine, theirs] : [theirs, mine];
    const st = useGameStore.getState();
    if (st.versus?.matchId === s.matchId) return;
    st.updateSettings({ compRoundSeconds: s.cfg.round });
    st.startVersus(
      {
        kind: 'online',
        characters: [byCorner[0].fighter, byCorner[1].fighter],
        belts: [byCorner[0].belt, byCorner[1].belt],
        names: [byCorner[0].nick || 'Player', byCorner[1].nick || 'Player'],
        me,
        host: s.role === 'host',
        matchId: s.matchId,
      },
      s.cfg.mode,
    );
    // Only a new match id starts a match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.status, s.matchId]);
}

