import { useCallback, useEffect, useState } from 'react';
import type { RoomSummary } from '@teeto/shared';
import { Avatar } from '../components/Avatar';
import { ConfirmDialog } from '../components/Modal';
import { useToast } from '../components/Toasts';
import { ArrowRightIcon, ClockIcon, EditIcon, EyeIcon, PlusIcon, TrashIcon } from '../components/icons';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { forgetHostToken, getHostToken, getSession } from '../lib/session';
import { CreateRoomModal } from './CreateRoomModal';
import './lobby.css';

const POLL_MS = 3000;

function fmtMinutes(s: number) {
  return s < 60 ? `${s}s` : `${Math.round(s / 60)} min`;
}

export function Lobby({ onChangeName }: { onChangeName: () => void }) {
  const toast = useToast();
  const session = getSession();
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<RoomSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setRooms(await api.listRooms());
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  async function confirmDelete() {
    if (!toDelete) return;
    const token = getHostToken(toDelete.id);
    if (!token) return;
    setDeleting(true);
    try {
      await api.deleteRoom(toDelete.id, token);
      forgetHostToken(toDelete.id);
      toast('success', 'Room deleted.');
      setToDelete(null);
      void load();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand__a">Teeto</span><span className="brand__b">Sathya</span>
        </div>
        <button className="user-chip" onClick={onChangeName} title="Change username">
          <Avatar name={session.username ?? '?'} size={28} />
          <span>{session.username}</span>
          <EditIcon width={16} height={16} />
        </button>
      </header>

      <main className="lobby">
        <div className="lobby__head">
          <h1>Debate rooms</h1>
          {loadError && <span className="pill pill--danger" role="alert">{loadError}</span>}
        </div>

        <div className="room-grid">
          <button className="room-card room-card--create" onClick={() => setCreating(true)}>
            <span className="room-card__plus"><PlusIcon width={28} height={28} /></span>
            <span className="room-card__create-title">Create room</span>
            <span className="muted">Pick a topic, two sides and the clock.</span>
          </button>

          {rooms === null &&
            Array.from({ length: 3 }, (_, i) => <div key={i} className="room-card skeleton" aria-hidden="true" />)}

          {rooms?.map((r) => {
            const isHost = !!getHostToken(r.id);
            return (
              <article key={r.id} className="room-card">
                <div className="room-card__top">
                  <span className={`status status--${r.status}`}>{r.status === 'live' ? 'LIVE' : r.status === 'lobby' ? 'Lobby' : 'Ended'}</span>
                  {isHost && <span className="pill">You host</span>}
                </div>
                <h2 className="room-card__topic">{r.topic}</h2>
                <div className="versus">
                  <span className="side-pill side-pill--a">{r.sides[0]}</span>
                  <span className="versus__vs">vs</span>
                  <span className="side-pill side-pill--b">{r.sides[1]}</span>
                </div>
                <dl className="room-card__meta">
                  <div><dt className="sr-only">Seats</dt><dd><span className="seat-count seat-count--a">{r.speakerCounts[0]}/{r.settings.speakersPerTeamMax}</span> · <span className="seat-count seat-count--b">{r.speakerCounts[1]}/{r.settings.speakersPerTeamMax}</span> speakers</dd></div>
                  <div><dt className="sr-only">Spectators</dt><dd><EyeIcon width={16} height={16} /> {r.spectatorCount} watching</dd></div>
                  <div><dt className="sr-only">Clock</dt><dd><ClockIcon width={16} height={16} /> {fmtMinutes(r.settings.turnSeconds)} each · {fmtMinutes(r.settings.roundSeconds)} round</dd></div>
                </dl>
                <div className="room-card__actions">
                  {isHost && (
                    <button className="btn btn--ghost btn--sm" onClick={() => setToDelete(r)} aria-label={`Delete room ${r.topic}`}>
                      <TrashIcon width={16} height={16} /> Delete
                    </button>
                  )}
                  <button className="btn btn--primary btn--sm" onClick={() => navigate(`/room/${r.id}`)} disabled={r.status === 'ended'}>
                    Join <ArrowRightIcon width={16} height={16} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        {rooms?.length === 0 && <p className="empty">No rooms yet. Create the first one.</p>}
      </main>

      <CreateRoomModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); navigate(`/room/${id}`); }} />
      <ConfirmDialog
        open={!!toDelete}
        title="End & delete room?"
        message={`"${toDelete?.topic ?? ''}" will be closed for everyone, and voice will disconnect. This can't be undone.`}
        confirmLabel="Delete room"
        danger
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
