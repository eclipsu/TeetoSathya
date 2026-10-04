import { useEffect, useRef, useState } from 'react';
import { APP_NAME, factCheckBlockReason, factCheckContextFromSnapshot, type ClaimOption, type TeamIndex } from '@teeto/shared';
import { Avatar } from '../components/Avatar';
import { ConnectionChip } from '../components/ConnectionChip';
import { useToast } from '../components/Toasts';
import { ArrowLeftIcon, CopyIcon, UsersIcon } from '../components/icons';
import { api } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { navigate } from '../lib/router';
import { forgetHostToken, getHostToken, getSession } from '../lib/session';
import { useRoom } from '../state/useRoom';
import { VoiceProvider, useVoice } from '../voice/VoiceProvider';
import { DebateCapture } from '../voice/debateCapture';
import { VoiceDock } from '../voice/VoiceDock';
import { micClosedReason, spaceAction } from '../state/rules';
import { useSpaceKey } from '../state/useSpaceKey';
import { useGameSounds } from '../state/useGameSounds';
import { playBuzz, playYourTurn, primeAudio } from '../lib/sfx';
import { SfxToggle } from '../components/SfxToggle';
import { BuzzOverlay } from './room/BuzzOverlay';
import { KeyHintBar } from './room/KeyHintBar';
import './room/buzz.css';
import { RolePicker } from './room/RolePicker';
import { SpectatorStrip } from './room/SpectatorStrip';
import { TeamColumn } from './room/TeamColumn';
import { HostControlBar } from './room/HostControlBar';
import { Stage } from './room/Stage';
import { Summary } from './room/Summary';
import { ClaimPanel, FactChat, FactCheckButton, type ClaimPanelState } from './room/FactCheck';
import { HostedRoomSubscription, hostedSpacetimeDatabase } from '../spacetime/hosted';
import { useSpokenLines } from '../state/useSpokenLines';
import './room/room.css';
import './room/stage.css';

const CLOSED_PANEL: ClaimPanelState = { open: false, loading: false, claims: [], speakerName: null, error: null, busy: false };
const CLAIM_POLL_MS = 4000;

export function RoomScreen({ roomId }: { roomId: string }) {
  const room = useRoom(roomId);
  const toast = useToast();
  const { status, snapshot, me, myId, isHost } = room;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [demo, setDemo] = useState<{ busy: boolean; gemini: string | null; claude: string | null; claims: string[] }>({ busy: false, gemini: null, claude: null, claims: [] });
  const [claimPanel, setClaimPanel] = useState<ClaimPanelState>(CLOSED_PANEL);
  const factGen = useRef(0);
  const action = snapshot ? spaceAction(snapshot, myId) : null;
  const actionRef = useRef(action);
  actionRef.current = action;

  // One press path for SPACE and the on-screen button (shared 1.5s cooldown).
  const press = useSpaceKey(status === 'joined' && snapshot?.status === 'live', () => {
    primeAudio();
    const a = actionRef.current;
    if (a?.action === 'done') void done();
    else if (a?.action === 'buzz') void buzz();
    else if (a?.action === 'factcheck') openClaimPanel();
  });

  useGameSounds(snapshot);
  const speakingLine = useSpokenLines(room.socket);

  // Buzz moment: sound for everyone in the room.
  useEffect(() => {
    if (room.buzzEvent) playBuzz();
  }, [room.buzzEvent]);

  // Chime when the floor passes to me.
  const holdsFloor = !!snapshot && snapshot.status === 'live' && !snapshot.game.paused && !snapshot.game.buzz && !snapshot.game.factCheck &&
    snapshot.game.activeSide !== null && snapshot.game.hotSeat[snapshot.game.activeSide] === myId;
  const prevHolds = useRef(holdsFloor);
  useEffect(() => {
    if (holdsFloor && !prevHolds.current) playYourTurn();
    prevHolds.current = holdsFloor;
  }, [holdsFloor]);

  // Any click in the room unlocks Web Audio for sound effects.
  useEffect(() => {
    const unlock = () => primeAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const prev = document.title;
    document.title = `${snapshot.status === 'live' ? '● ' : ''}${snapshot.topic} · TeetoSathya`;
    return () => { document.title = prev; };
  }, [snapshot?.topic, snapshot?.status]);

  // First entry: role picker opens until a role is chosen.
  useEffect(() => {
    if (status === 'joined' && me && me.role === null) setPickerOpen(true);
  }, [status, me]);

  // While the picker is open the speaker keeps talking, so pick up their newest claims.
  const canCheck = !!snapshot && !factCheckBlockReason(factCheckContextFromSnapshot(snapshot, myId));
  const speakerKey = snapshot?.game.activeSide != null ? snapshot.game.hotSeat[snapshot.game.activeSide] : null;
  useEffect(() => {
    if (!claimPanel.open || claimPanel.busy) return;
    if (!canCheck) return closeClaimPanel();
    const gen = factGen.current;
    const t = setInterval(() => void loadClaims(gen), CLAIM_POLL_MS);
    return () => clearInterval(t);
  }, [claimPanel.open, claimPanel.busy, canCheck]);
  // The floor passed to someone else: their claims replace the old list.
  useEffect(() => {
    if (claimPanel.open && !claimPanel.busy) void loadClaims(factGen.current);
  }, [speakerKey]);

  async function hostCall(event: string, extra: Record<string, unknown> = {}, timeoutMs?: number) {
    const res = await room.call(event as never, { hostToken: getHostToken(roomId), ...extra }, timeoutMs);
    if (!res.ok) toast('error', res.message);
    return res.ok;
  }

  // The server writes and voices the opening announcement first, so this can take a few seconds.
  async function startRound() {
    setStarting(true);
    await hostCall('host:startRound', {}, 20_000);
    setStarting(false);
  }

  async function deleteRoom() {
    const token = getHostToken(roomId);
    if (!token) return toast('error', 'Host token missing on this device.');
    try {
      await api.deleteRoom(roomId, token);
      forgetHostToken(roomId);
      navigate('/');
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  async function buzz() {
    const res = await room.call('buzz:press', { clientAt: Date.now() });
    if (res.ok && res.result === 'too_late') toast('info', 'Too late. Someone beat you to it.');
    else if (!res.ok && res.code !== 'rate_limited') toast('warn', res.message);
  }

  async function done() {
    const res = await room.call('turn:done');
    if (!res.ok) toast('warn', res.message);
  }

  async function runDummySummary() {
    setDemo({ busy: true, gemini: null, claude: null, claims: [] });
    const res = await room.call('claims:demo', undefined, 20_000);
    if (!res.ok) {
      setDemo({ busy: false, gemini: null, claude: null, claims: [] });
      toast('error', res.message);
      return;
    }
    const claims = Array.isArray(res.claims) ? res.claims.filter((c): c is string => typeof c === 'string') : [];
    setDemo({
      busy: false,
      gemini: typeof res.gemini === 'string' ? res.gemini : null,
      claude: typeof res.claude === 'string' ? res.claude : null,
      claims,
    });
  }

  // Browsing claims is local to the challenger: nothing pauses until they press Challenge.
  async function loadClaims(gen: number) {
    const res = await room.call('factcheck:options', undefined, 8_000);
    if (factGen.current !== gen) return;
    if (!res.ok) {
      setClaimPanel((p) => ({ ...p, loading: false, error: res.message }));
      return;
    }
    const claims = Array.isArray(res.claims) ? res.claims as ClaimOption[] : [];
    const speakerName = typeof res.speakerName === 'string' ? res.speakerName : null;
    setClaimPanel((p) => ({ ...p, loading: false, claims, speakerName, error: null }));
  }

  /** SPACE: open the picker (never closes it, so a second press can't drop a half-made choice). */
  function openClaimPanel() {
    if (!claimPanel.open) toggleClaimPanel();
  }

  function toggleClaimPanel() {
    if (claimPanel.open) return closeClaimPanel();
    const gen = ++factGen.current;
    setClaimPanel({ ...CLOSED_PANEL, open: true, loading: true });
    void room.call('factcheck:considering', { on: true });
    void loadClaims(gen);
  }

  async function submitFactCheck(claimId: string) {
    const gen = factGen.current;
    setClaimPanel((p) => ({ ...p, busy: true, error: null }));
    const res = await room.call('factcheck:submit', { claimId }, 8_000);
    if (factGen.current !== gen) return;
    if (!res.ok) {
      setClaimPanel((p) => ({ ...p, busy: false, error: res.message }));
      toast('error', res.message);
      return;
    }
    closeClaimPanel();
  }

  function closeClaimPanel() {
    factGen.current += 1;
    setClaimPanel(CLOSED_PANEL);
    // After a submit the server already cleared it; this is a no-op then.
    void room.call('factcheck:considering', { on: false });
  }

  async function pick(role: 'speaker' | 'spectator', team: TeamIndex | null) {
    setBusy(true);
    const res = await room.call('role:set', { role, team });
    setBusy(false);
    if (!res.ok) toast('error', res.message);
    else setPickerOpen(false);
  }

  if (status === 'name_taken' && room.error) return <NameConflict message={room.error.message} suggestions={room.error.suggestions ?? []} onPick={room.retryWithName} />;
  if (status === 'not_found') return <Gone title="Room not found" message="It may have been deleted, or it closed after everyone left." />;
  if (status === 'closed') return <Gone title="Room closed" message={room.closedReason ?? 'This room was closed.'} />;
  if (status === 'replaced') return <Gone title="Opened elsewhere" message="You opened this room in another tab or device. This tab is now disconnected." action="Reconnect here" onAction={() => location.reload()} />;
  if (status === 'error' && room.error) return <Gone title="Couldn't join" message={room.error.message} action="Try again" onAction={() => location.reload()} />;
  if (!snapshot) return <RoomSkeleton />;

  const canTakeSeat = snapshot.status !== 'ended' && me?.role !== 'speaker';
  const hotSeatAction = isHost && snapshot.status !== 'ended'
    ? (side: TeamIndex, participantId: string) => void hostCall('host:setHotSeat', { side, participantId })
    : undefined;
  const chip =
    status === 'joined' ? { state: 'ok' as const, label: 'Connected' } :
    status === 'reconnecting' ? { state: 'warn' as const, label: 'Reconnecting…' } :
    { state: 'idle' as const, label: 'Connecting…' };

  return (
    <VoiceProvider roomId={roomId} holdMic={!!snapshot.game.factCheck} ended={snapshot.status === 'ended'} onConnected={() => void room.call('voice:joined')}>
      {hostedSpacetimeDatabase ? <HostedRoomSubscription roomId={roomId} /> : null}
      <FloorCapture socket={room.socket} enabled={holdsFloor} />
      <div className="room" data-status={snapshot.status} data-host={isHost}>
        <header className="room__header tile">
          <div className="room__header-left">
            <button className="icon-btn" onClick={async () => { await room.leave(); navigate('/'); }} aria-label="Leave room">
              <ArrowLeftIcon />
            </button>
            <div className="room__brand">
              <span className="brand">{APP_NAME}</span>
              <span className="room__view label">
                {isHost ? 'Host view' : me?.role === 'spectator' ? 'Spectator view' : me?.role === 'speaker' ? 'Speaker view' : 'Joining'}
                {snapshot.game.round > 0 && ` · Round ${snapshot.game.round}`}
              </span>
              <span className="room__listening">
                {snapshot.participants.filter((p) => p.connected).length} listening · <ConnectionChip {...chip} />
              </span>
            </div>
          </div>
          <div className="room__title">
            <h1 className="room__topic">{snapshot.topic}</h1>
            <div className="sides">
              <span className="side-pill"><span className="dot dot--a" /><span>{snapshot.sides[0]}</span></span>
              <span className="side-pill"><span className="dot dot--b" /><span>{snapshot.sides[1]}</span></span>
            </div>
          </div>
          <div className="room__header-right">
            <button
              className="btn btn--ghost btn--sm"
              onClick={async () => {
                const ok = await copyText(location.href);
                toast(ok ? 'success' : 'warn', ok ? 'Room link copied.' : `Copy this link: ${location.href}`);
              }}
            >
              <CopyIcon width={16} height={16} /> <span className="btn__label">Copy link</span>
            </button>
            {snapshot.status !== 'ended' && (
              <button className="btn btn--ghost btn--sm" onClick={() => setPickerOpen(true)}>
                <UsersIcon width={16} height={16} /> <span className="btn__label">{me?.role === 'spectator' ? 'Spectator' : me?.team != null ? snapshot.sides[me.team] : 'Pick role'}</span>
              </button>
            )}
            <SfxToggle />
            <VoiceDock isSpeaker={me?.role === 'speaker'} micReason={micClosedReason(snapshot, myId)} />
            <span className="me-chip" title={me?.username}>
              <Avatar name={me?.username ?? getSession().username ?? '?'} size={28} />
            </span>
          </div>
        </header>

        {snapshot.status === 'ended' ? (
          <main className="room__main room__main--summary">
            <Summary snapshot={snapshot} isHost={isHost} onPickWinner={(winner) => void hostCall('host:pickWinner', { winner })} />
          </main>
        ) : (
          <main className="room__main">
            <TeamColumn team={0} snapshot={snapshot} myId={myId} canTakeSeat={canTakeSeat} onTakeSeat={(t) => pick('speaker', t)} onHotSeat={hotSeatAction} />
            <Stage
              snapshot={snapshot}
              myId={myId}
              isHost={isHost}
              onDone={done}
              onStart={() => void startRound()}
              starting={starting}
              interimText={room.interim && snapshot.game.activeSide !== null && snapshot.game.hotSeat[snapshot.game.activeSide] === room.interim.speakerId ? room.interim.text : null}
              transcriptionAvailable={room.transcriptionAvailable}
              speakingId={speakingLine}
              picker={claimPanel.open ? <ClaimPanel state={claimPanel} onClose={closeClaimPanel} onSubmit={(id) => void submitFactCheck(id)} /> : undefined}
            />
            <FactChat
              items={snapshot.game.factChecks}
              live={snapshot.status === 'live'}
              action={snapshot.status === 'live' ? <FactCheckButton snapshot={snapshot} myId={myId} open={claimPanel.open} onOpen={toggleClaimPanel} /> : undefined}
            />
            <TeamColumn team={1} snapshot={snapshot} myId={myId} canTakeSeat={canTakeSeat} onTakeSeat={(t) => pick('speaker', t)} onHotSeat={hotSeatAction} />
            <SpectatorStrip snapshot={snapshot} myId={myId} />
          </main>
        )}

        {(demo.gemini || demo.claude) && (
          <section className="factcheck-history tile" aria-label="Dummy fact summary">
            <h3>TEMP TEST SUMMARY</h3>
            <p>Gemini: {demo.gemini}</p>
            <p>Claude: {demo.claude}</p>
            {demo.claims.length > 0 && (
              <ul>
                {demo.claims.map((claim) => <li key={claim}>{claim}</li>)}
              </ul>
            )}
          </section>
        )}

        <div className="room__footer">
          {snapshot.status === 'live' && (
            <button className="btn btn--ghost btn--sm" type="button" disabled={demo.busy} onClick={() => void runDummySummary()}>
              {demo.busy ? 'Testing summary…' : 'Test summary'}
            </button>
          )}
          {snapshot.status !== 'ended' && action && (
            <KeyHintBar action={action} isSpectator={me?.role === 'spectator'} onPress={press} />
          )}
          {isHost && <HostControlBar snapshot={snapshot} hostCall={hostCall} onDelete={deleteRoom} />}
        </div>

        <BuzzOverlay
          locked={snapshot.game.buzz}
          challengedName={snapshot.participants.find((p) => p.id === snapshot.game.buzz?.challengedParticipantId)?.username ?? null}
        />

        {!isHost && snapshot.status === 'ended' && (
          <div className="summary__actions">
            <button className="btn btn--primary" onClick={() => navigate('/')}><ArrowLeftIcon /> Back to rooms</button>
          </div>
        )}

        <RolePicker
          open={pickerOpen}
          snapshot={snapshot}
          isHost={isHost}
          required={me?.role === null}
          busy={busy}
          onPick={pick}
          onClose={() => setPickerOpen(false)}
        />
      </div>
    </VoiceProvider>
  );
}

function FloorCapture({ socket, enabled }: { socket: ReturnType<typeof useRoom>['socket']; enabled: boolean }) {
  const voice = useVoice();
  return <DebateCapture socket={socket} track={voice.localMicTrack} enabled={enabled && voice.micLive} />;
}

function NameConflict({ message, suggestions, onPick }: { message: string; suggestions: string[]; onPick: (n: string) => void }) {
  return (
    <main className="placeholder">
      <h1 className="placeholder__title">Name taken</h1>
      <p className="muted">{message} Pick another one for this room:</p>
      <div className="chips" style={{ justifyContent: 'center' }}>
        {suggestions.map((s) => (
          <button key={s} className="chip chip--suggest" onClick={() => onPick(s)}>
            <Avatar name={s} size={22} /> {s}
          </button>
        ))}
      </div>
      <button className="btn btn--ghost" onClick={() => navigate('/')}><ArrowLeftIcon /> Back to rooms</button>
    </main>
  );
}

function Gone({ title, message, action, onAction }: { title: string; message: string; action?: string; onAction?: () => void }) {
  return (
    <main className="placeholder">
      <h1 className="placeholder__title">{title}</h1>
      <p className="muted">{message}</p>
      <div className="chips">
        {action && <button className="btn btn--primary" onClick={onAction}>{action}</button>}
        <button className="btn btn--ghost" onClick={() => navigate('/')}><ArrowLeftIcon /> Back to rooms</button>
      </div>
    </main>
  );
}

function RoomSkeleton() {
  return (
    <div className="room" aria-busy="true">
      <header className="room__header skeleton" style={{ minHeight: 88 }} />
      <main className="room__main">
        <div className="team skeleton" />
        <div className="stage skeleton" />
        <div className="team team--1 skeleton" />
      </main>
    </div>
  );
}
