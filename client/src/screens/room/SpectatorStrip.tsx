import type { ParticipantView, RoomSnapshot } from '@teeto/shared';
import { Avatar } from '../../components/Avatar';
import { levelStyle, useSpeaking } from '../../voice/useSpeaking';

const SHOWN = 8;

/** One-line strip: a few spectator avatars, then a count for the rest. */
export function SpectatorStrip({ snapshot, myId }: { snapshot: RoomSnapshot; myId: string | null }) {
  const spectators = snapshot.participants.filter((p) => p.role === 'spectator');
  const undecided = snapshot.participants.filter((p) => p.role === null).length;
  // Keep "you" visible even in a full room.
  const ordered = [...spectators].sort((a, b) => Number(b.id === myId) - Number(a.id === myId));
  const shown = ordered.slice(0, SHOWN);
  const rest = spectators.length - shown.length;
  const listening = snapshot.participants.filter((p) => p.connected).length;

  return (
    <section className="spectators tile" aria-label={`Spectators: ${spectators.length}`}>
      <span className="spectators__label">Spectators</span>
      {spectators.length === 0 ? (
        <span className="muted spectators__empty">None yet. Spectators can buzz in to challenge.</span>
      ) : (
        <ul className="spectators__list">
          {shown.map((p) => <Spectator key={p.id} p={p} isMe={p.id === myId} />)}
        </ul>
      )}
      <span className="spectators__more">
        {rest > 0 && `+${rest} · `}{listening} listening{undecided > 0 && ` · ${undecided} choosing a side`}
      </span>
    </section>
  );
}

function Spectator({ p, isMe }: { p: ParticipantView; isMe: boolean }) {
  // Spectators never publish, but the hook keeps them consistent if that ever changes.
  const { speaking, level } = useSpeaking(p.id);
  return (
    <li className={`spectator ${p.connected ? '' : 'spectator--away'} ${isMe ? 'spectator--me' : ''}`} data-participant={p.id} title={isMe ? `${p.username} (you)` : p.username} style={levelStyle(level)}>
      <Avatar name={p.username} size={28} speaking={speaking} />
    </li>
  );
}
