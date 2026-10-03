import type { RoomSnapshot, TeamIndex } from '@teeto/shared';
import { Modal } from '../../components/Modal';
import { EyeIcon, MicIcon } from '../../components/icons';

interface RolePickerProps {
  open: boolean;
  snapshot: RoomSnapshot;
  isHost: boolean;
  /** First entry: user must choose before continuing. */
  required: boolean;
  busy: boolean;
  onPick: (role: 'speaker' | 'spectator', team: TeamIndex | null) => void;
  onClose: () => void;
}

export function RolePicker({ open, snapshot, isHost, required, busy, onPick, onClose }: RolePickerProps) {
  const max = snapshot.settings.speakersPerTeamMax;
  const count = (t: TeamIndex) => snapshot.participants.filter((p) => p.role === 'speaker' && p.team === t).length;
  return (
    <Modal open={open} onClose={onClose} title="How do you want to join?" sheet dismissible={!required}>
      <p className="muted role-picker__topic">“{snapshot.topic}”</p>
      <div className="role-picker">
        {([0, 1] as const).map((t) => {
          const full = count(t) >= max;
          return (
            <button
              key={t}
              className={`role-option role-option--team-${t}`}
              disabled={busy || full}
              onClick={() => onPick('speaker', t)}
              data-autofocus={t === 0 ? true : undefined}
            >
              <MicIcon />
              <span className="role-option__title">Speak for {snapshot.sides[t]}</span>
              <span className="role-option__sub">{full ? 'Team full' : `${count(t)}/${max} seats taken`}</span>
            </button>
          );
        })}
        <button
          className="role-option role-option--spectator"
          disabled={busy || isHost}
          onClick={() => onPick('spectator', null)}
        >
          <EyeIcon />
          <span className="role-option__title">Watch as spectator</span>
          <span className="role-option__sub">{isHost ? 'The host plays on a team' : 'Listen, and buzz in with SPACE'}</span>
        </button>
      </div>
    </Modal>
  );
}
