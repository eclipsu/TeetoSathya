import { useCallback, useEffect, useState } from 'react';
import { APP_NAME, type RoomSummary } from '@teeto/shared';
import { Avatar } from '../components/Avatar';
import { ConfirmDialog } from '../components/Modal';
import { useToast } from '../components/Toasts';
import { ArrowRightIcon, ClockIcon, EditIcon, EyeIcon, TrashIcon, UsersIcon } from '../components/icons';
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
        <div className="frame">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>{APP_NAME}</a>
        <nav className="topnav" aria-label="Page">
          <button className="user-chip" onClick={onChangeName} title="Change username">
            <Avatar name={session.username ?? '?'} size={24} />
            <span>{session.username}</span>
            <EditIcon width={14} height={14} />
          </button>
          <button className="btn btn--sm" onClick={() => setCreating(true)}>Create room</button>
        </nav>
        </div>
      </header>

      <main className="lobby lobby--center">
        <div className="land-split">
          <div className="land-copy">
            <section className="land" aria-label="What TeetoSathya is">
              <p className="land__pill"><span className="land__dot" aria-hidden="true" /> Live debate · Fact check game</p>
              <h1>Say it.<br />Defend it.<br /><em>Get fact-checked.</em></h1>
              <p className="land__lead">A live team debate where factual claims can be challenged. Call a fact check while your opponent speaks. Gemini and Claude review the claim. A wrong claim scores +100. A claim that holds is −50.</p>
              <div className="land__actions">
                <button className="btn btn--primary btn--lg" onClick={() => setCreating(true)}>Create room <ArrowRightIcon /></button>
              </div>
              <ul className="land__stakes">
                <li><strong>+100</strong><span>Wrong claim</span></li>
                <li><strong>−50</strong><span>Claim holds</span></li>
                <li><strong>0</strong><span>Split jury</span></li>
              </ul>
            </section>
          </div>

          <aside className="floor" aria-label="Open rooms">
            <header className="floor__bar">
              <h2>Open rooms</h2>
              <span>{rooms && rooms.length > 0 ? rooms.length : 'Sample'}</span>
            </header>
            {loadError && <p className="pill pill--danger floor__error" role="alert">{loadError}</p>}
            {rooms && rooms.length > 0 ? (
              <div className="floor__rooms">
                {rooms.map((r) => {
                  const isHost = !!getHostToken(r.id);
                  return (
                    <article key={r.id} className="floor__room">
                      <div className="floor__room-top">
                        <span className={`status status--${r.status}`}>{r.status === 'live' ? 'Live' : r.status === 'lobby' ? 'Open' : 'Ended'}</span>
                        {isHost && <span className="pill">You host</span>}
                      </div>
                      <h3>{r.topic}</h3>
                      <div className="sides">
                        <span className="side-pill"><span className="dot dot--a" /><span>{r.sides[0]}</span></span>
                        <span className="side-pill"><span className="dot dot--b" /><span>{r.sides[1]}</span></span>
                      </div>
                      <dl className="floor__meta">
                        <div><dt className="sr-only">Seats</dt><dd><UsersIcon /> {r.speakerCounts[0]}/{r.settings.speakersPerTeamMax} · {r.speakerCounts[1]}/{r.settings.speakersPerTeamMax}</dd></div>
                        <div><dt className="sr-only">Spectators</dt><dd><EyeIcon /> {r.spectatorCount}</dd></div>
                        <div><dt className="sr-only">Clock</dt><dd><ClockIcon /> {fmtMinutes(r.settings.turnSeconds)} · {fmtMinutes(r.settings.roundSeconds)}</dd></div>
                      </dl>
                      <div className="floor__room-actions">
                        {isHost && (
                          <button className="btn btn--ghost btn--sm" onClick={() => setToDelete(r)} aria-label={`Delete room ${r.topic}`}>
                            <TrashIcon /> Delete
                          </button>
                        )}
                        <button className="btn btn--primary btn--sm" onClick={() => navigate(`/room/${r.id}`)} disabled={r.status === 'ended'}>
                          Join <ArrowRightIcon />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="floor__body">
                <h3 className="floor__topic">Where do people do their best work?</h3>
                <div className="floor__teams">
                  <div className="floor__team">
                    <span className="floor__side"><span className="dot dot--a" /> Home</span>
                    <div className="floor__faces">
                      <Avatar name="Maya" size={36} />
                      <Avatar name="Ari" size={36} />
                    </div>
                    <span className="floor__who">Maya · Ari</span>
                  </div>
                  <div className="floor__team">
                    <span className="floor__side"><span className="dot dot--b" /> Office</span>
                    <div className="floor__faces">
                      <Avatar name="Leo" size={36} />
                      <Avatar name="Noor" size={36} />
                    </div>
                    <span className="floor__who">Leo · Noor</span>
                  </div>
                </div>
                <ul className="floor__stats">
                  <li><span>Turn</span><strong>2 min</strong></li>
                  <li><span>Round</span><strong>10 min</strong></li>
                  <li><span>Watching</span><strong>2</strong></li>
                </ul>
              </div>
            )}
          </aside>
        </div>

        <footer className="powered">
          <p>Powered by</p>
          <ul>
            <li>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><rect x="3" y="9" width="3" height="6" rx="1" /><rect x="8" y="5" width="3" height="14" rx="1" /><rect x="13" y="8" width="3" height="8" rx="1" /><rect x="18" y="4" width="3" height="16" rx="1" /></svg>
              ElevenLabs
            </li>
            <li>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="8" /><ellipse cx="12" cy="12" rx="8" ry="3.2" /><path d="M12 4v16" /></svg>
              SpacetimeDB
            </li>
            <li>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2.2l1.7 6.6 6.6 1.7-6.6 1.7L12 18.8l-1.7-6.6L3.7 10.5l6.6-1.7L12 2.2z" /><path d="M18.2 15.2l.7 2.4 2.4.7-2.4.7-.7 2.4-.7-2.4-2.4-.7 2.4-.7.7-2.4z" /></svg>
              Gemini
            </li>
            <li>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M22.3 9.8a6 6 0 0 0-.5-4.9 6 6 0 0 0-6.5-2.9A6 6 0 0 0 5 4.2a6 6 0 0 0-4 2.9 6 6 0 0 0 .7 7.1 6 6 0 0 0 .5 4.9 6 6 0 0 0 6.5 2.9A6 6 0 0 0 13.3 24a6 6 0 0 0 5.8-4.2 6 6 0 0 0 4-2.9 6 6 0 0 0-.8-7.1zM13.3 22.4a4.5 4.5 0 0 1-2.9-1l.1-.1 4.8-2.8a.8.8 0 0 0 .4-.6V11l2 1.2v5.6a4.5 4.5 0 0 1-4.4 4.6zM3.1 18.4a4.5 4.5 0 0 1-.5-3l.1.1 4.8 2.8a.8.8 0 0 0 .8 0l5.8-3.4v2.3l-4.8 2.8a4.5 4.5 0 0 1-6.2-1.6zM19.7 15.1l-.1-.1-4.8-2.8a.8.8 0 0 0-.8 0L8.2 15.6V13l.1-.1 4.8-2.8a4.5 4.5 0 0 1 6.6 4.9zM4.2 8.2l.2.1 4.8 2.7a.8.8 0 0 0 .8 0l5.8-3.4V5.3l.1-.1 4.8-2.8a4.5 4.5 0 0 1-.7 8.2l-4.8-2.8a.8.8 0 0 0-.8 0L9 11.1V8.8l4.9-2.8a4.5 4.5 0 0 1-9.7 2.2zm11 1.5-2-1.2 2-1.1v2.3zm1 1.1-5 2.9-2-1.2V9.3l5-2.9 2 1.2v2.2zM6.2 16.6l-2-1.2v-2.3l2 1.2v2.3zm-1-7 5-2.9 2 1.2v2.3l-5 2.9-2-1.2V9.6zm10 3.5-2 1.2-5-2.9 2-1.2 5 2.9z" /></svg>
              OpenAI
            </li>
          </ul>
        </footer>
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
