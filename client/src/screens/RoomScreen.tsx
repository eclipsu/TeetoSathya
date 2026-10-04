import { useEffect, useRef, useState } from 'react';
import type { ClaimOption, TeamIndex } from '@teeto/shared';
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
import { FactChat, FactCheckButton, FactCheckPicker } from './room/FactCheck';
import './room/room.css';
import './room/stage.css';

export function RoomScreen({ roomId }: { roomId: string }) {
  const room = useRoom(roomId);
  const toast = useToast();
  const { status, snapshot, me, myId, isHost } = room;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<{ busy: boolean; gemini: string | null; claude: string | null; claims: string[] }>({ busy: false, gemini: null, claude: null, claims: [] });
  const [factPicker, setFactPicker] = useState<{ open: boolean; loading: boolean; claims: ClaimOption[]; speakerName: string | null; error: string | null; busy: boolean }>({
    open: false, loading: false, claims: [], speakerName: null, error: null, busy: false,
  });
  const factGen = useRef(0);
  const [shaking, setShaking] = useState(false);
  const action = snapshot ? spaceAction(snapshot, myId) : null;
  const actionRef = useRef(action);
  actionRef.current = action;

  // One press path for SPACE and the on-screen button (shared 1.5s cooldown).
  const press = useSpaceKey(status === 'joined' && snapshot?.status === 'live', () => {
    primeAudio();
    const a = actionRef.current;
    if (a?.action === 'done') void done();
    else if (a?.action === 'buzz') void buzz();
  });

  // Buzz moment: sound + one stage shake, for everyone in the room.
  useEffect(() => {
    if (!room.buzzEvent) return;
    playBuzz();
    setShaking(true);
    const t = setTimeout(() => setShaking(false), 400);
    return () => clearTimeout(t);
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

  async function hostCall(event: string, extra: Record<string, unknown> = {}) {
    const res = await room.call(event as never, { hostToken: getHostToken(roomId), ...extra });
    if (!res.ok) toast('error', res.message);
    return res.ok;
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

  async function openFactCheck() {
    const gen = ++factGen.current;
    setFactPicker({ open: true, loading: true, claims: [], speakerName: null, error: null, busy: false });
    const res = await room.call('factcheck:options', undefined, 18_000);
    if (factGen.current !== gen) {
      void room.call('factcheck:cancel');
      return;
    }
    if (!res.ok) {
      setFactPicker((p) => ({ ...p, loading: false, error: res.message }));
      return;
    }
    const claims = Array.isArray(res.claims) ? res.claims as ClaimOption[] : [];
    const speakerName = typeof res.speakerName === 'string' ? res.speakerName : null;
    setFactPicker((p) => ({ ...p, loading: false, claims, speakerName, error: null }));
  }

  async function submitFactCheck(claimId: string) {
    setFactPicker((p) => ({ ...p, busy: true, error: null }));
    const res = await room.call('factcheck:submit', { claimId }, 8_000);
    if (!res.ok) {
      setFactPicker((p) => ({ ...p, busy: false, error: res.message }));
      toast('error', res.message);
      return;
    }
    factGen.current += 1;
    setFactPicker({ open: false, loading: false, claims: [], speakerName: null, error: null, busy: false });
  }

  function closeFactPicker() {
    factGen.current += 1;
    setFactPicker((p) => ({ ...p, open: false, busy: false }));
    void room.call('factcheck:cancel');
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
    <VoiceProvider roomId={roomId} holdMic={!!snapshot.game.factCheck || !!snapshot.game.factCheckArmed} onConnected={() => void room.call('voice:joined')}>
      <FloorCapture socket={room.socket} enabled={holdsFloor} />
      <div className="room" data-status={snapshot.status} data-host={isHost}>
        <header className="room__header">
          <div className="room__header-left">
            <button className="icon-btn" onClick={async () => { await room.leave(); navigate('/'); }} aria-label="Leave room">
              <ArrowLeftIcon />
            </button>
            <ConnectionChip {...chip} />
          </div>
          <div className="room__title">
            <h1 className="room__topic">{snapshot.topic}</h1>
            <div className="versus">
              <span className="side-pill side-pill--a">{snapshot.sides[0]}</span>
              <span className="versus__vs">vs</span>
              <span className="side-pill side-pill--b">{snapshot.sides[1]}</span>
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
            <Summary snapshot={snapshot} />
          </main>
        ) : (
          <main className={`room__main ${shaking ? 'is-shaking' : ''}`}>
            <FactChat items={snapshot.game.factChecks} armed={snapshot.game.factCheckArmed} />
            <TeamColumn team={0} snapshot={snapshot} myId={myId} canTakeSeat={canTakeSeat} onTakeSeat={(t) => pick('speaker', t)} onHotSeat={hotSeatAction} />
            <Stage
              snapshot={snapshot}
              myId={myId}
              isHost={isHost}
              onDone={done}
              interimText={room.interim && snapshot.game.activeSide !== null && snapshot.game.hotSeat[snapshot.game.activeSide] === room.interim.speakerId ? room.interim.text : null}
              transcriptionAvailable={room.transcriptionAvailable}
            />
            <TeamColumn team={1} snapshot={snapshot} myId={myId} canTakeSeat={canTakeSeat} onTakeSeat={(t) => pick('speaker', t)} onHotSeat={hotSeatAction} />
          </main>
        )}

        <SpectatorStrip snapshot={snapshot} myId={myId} />

        {(demo.gemini || demo.claude) && (
          <section className="factcheck-history" aria-label="Dummy fact summary">
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
            <FactCheckButton snapshot={snapshot} myId={myId} onOpen={() => void openFactCheck()} />
          )}
          {snapshot.status === 'live' && (
            <button className="btn btn--sm" type="button" disabled={demo.busy} onClick={() => void runDummySummary()}>
              {demo.busy ? 'Testing summary…' : 'Test summary'}
            </button>
          )}
          {snapshot.status !== 'ended' && action && (
            <KeyHintBar action={action} isSpectator={me?.role === 'spectator'} onPress={press} />
          )}
          {isHost && <HostControlBar snapshot={snapshot} hostCall={hostCall} onDelete={deleteRoom} />}
        </div>

        <FactCheckPicker
          open={factPicker.open}
          speakerName={factPicker.speakerName}
          loading={factPicker.loading}
          claims={factPicker.claims}
          error={factPicker.error}
          busy={factPicker.busy}
          onCancel={closeFactPicker}
          onSubmit={(id) => void submitFactCheck(id)}
        />

        <BuzzOverlay
          event={room.buzzEvent}
          locked={snapshot.game.buzz}
          challengedName={snapshot.participants.find((p) => p.id === (snapshot.game.buzz ?? room.buzzEvent?.buzz)?.challengedParticipantId)?.username ?? null}
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
      <h1 className="logo" style={{ fontSize: '2rem' }}>Name taken</h1>
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
      <h1 className="logo" style={{ fontSize: '2rem' }}>{title}</h1>
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
      <header className="room__header"><div /><div className="skeleton" style={{ minHeight: 56, width: 420, borderRadius: 12 }} /><div /></header>
      <main className="room__main">
        <div className="team skeleton" />
        <div className="stage skeleton" style={{ borderRadius: 18 }} />
        <div className="team skeleton" />
      </main>
    </div>
  );
}
