import { useEffect, useState } from 'react';
import type { TeamIndex } from '@teeto/shared';
import { Avatar } from '../components/Avatar';
import { ConnectionChip } from '../components/ConnectionChip';
import { useToast } from '../components/Toasts';
import { ArrowLeftIcon, CopyIcon, UsersIcon } from '../components/icons';
import { copyText } from '../lib/clipboard';
import { navigate } from '../lib/router';
import { getSession } from '../lib/session';
import { useRoom } from '../state/useRoom';
import { VoiceProvider } from '../voice/VoiceProvider';
import { VoiceDock } from '../voice/VoiceDock';
import { micClosedReason } from '../state/rules';
import { RolePicker } from './room/RolePicker';
import { SpectatorStrip } from './room/SpectatorStrip';
import { TeamColumn } from './room/TeamColumn';
import './room/room.css';

export function RoomScreen({ roomId }: { roomId: string }) {
  const room = useRoom(roomId);
  const toast = useToast();
  const { status, snapshot, me, myId, isHost } = room;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // First entry: role picker opens until a role is chosen.
  useEffect(() => {
    if (status === 'joined' && me && me.role === null) setPickerOpen(true);
  }, [status, me]);

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
  const chip =
    status === 'joined' ? { state: 'ok' as const, label: 'Connected' } :
    status === 'reconnecting' ? { state: 'warn' as const, label: 'Reconnecting…' } :
    { state: 'idle' as const, label: 'Connecting…' };

  return (
    <VoiceProvider roomId={roomId} onConnected={() => void room.call('voice:joined')}>
      <div className="room" data-status={snapshot.status}>
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
            <VoiceDock isSpeaker={me?.role === 'speaker'} micReason={micClosedReason(snapshot, myId)} />
            <span className="me-chip" title={me?.username}>
              <Avatar name={me?.username ?? getSession().username ?? '?'} size={28} />
            </span>
          </div>
        </header>

        <main className="room__main">
          <TeamColumn team={0} snapshot={snapshot} myId={myId} canTakeSeat={canTakeSeat} onTakeSeat={(t) => pick('speaker', t)} />
          <section className="stage" aria-label="Stage">
            <div className="stage__waiting glass">
              <h2>{snapshot.status === 'lobby' ? 'Waiting for the host to start' : snapshot.status === 'live' ? 'Round live' : 'Round over'}</h2>
              <p className="muted">
                {snapshot.settings.turnSeconds}s per speaker · {Math.round(snapshot.settings.roundSeconds / 60)} min round
              </p>
              {isHost && <p className="muted">You are the host.</p>}
            </div>
          </section>
          <TeamColumn team={1} snapshot={snapshot} myId={myId} canTakeSeat={canTakeSeat} onTakeSeat={(t) => pick('speaker', t)} />
        </main>

        <SpectatorStrip snapshot={snapshot} myId={myId} />

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
