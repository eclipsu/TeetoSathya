import type { RoomSnapshot } from '@teeto/shared';
import { Avatar } from '../../components/Avatar';
import { EyeIcon } from '../../components/icons';
import type { ParticipantView } from '@teeto/shared';
import { levelStyle, useSpeaking } from '../../voice/useSpeaking';

export function SpectatorStrip({ snapshot, myId }: { snapshot: RoomSnapshot; myId: string | null }) {
  const spectators = snapshot.participants.filter((p) => p.role === 'spectator');
  const undecided = snapshot.participants.filter((p) => p.role === null);
  return (
    <section className="spectators glass" aria-label="Spectators">
      <span className="spectators__label">
        <EyeIcon width={16} height={16} /> {spectators.length} watching
      </span>
      <ul className="spectators__list">
        {spectators.length === 0 && <li className="muted spectators__empty">No spectators yet. They can buzz in to challenge.</li>}
        {spectators.map((p) => <Spectator key={p.id} p={p} isMe={p.id === myId} />)}
        {undecided.length > 0 && <li className="muted spectators__pending">+{undecided.length} choosing a side…</li>}
      </ul>
    </section>
  );
}

function Spectator({ p, isMe }: { p: ParticipantView; isMe: boolean }) {
  // Spectators never publish, but the hook keeps them consistent if that ever changes.
  const { speaking, level } = useSpeaking(p.id);
  return (
    <li className={`spectator ${p.connected ? '' : 'spectator--away'}`} data-participant={p.id} title={p.username} style={levelStyle(level)}>
      <Avatar name={p.username} size={30} speaking={speaking} />
      <span className="spectator__name">{p.username}{isMe ? ' (you)' : ''}</span>
    </li>
  );
}
