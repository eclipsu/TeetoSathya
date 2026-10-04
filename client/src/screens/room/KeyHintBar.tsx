import type { SpaceAction } from '../../state/rules';
import { BellIcon, CheckIcon, LockIcon } from '../../components/icons';

interface Props {
  action: SpaceAction;
  isSpectator: boolean;
  onPress: () => void;
}

/** Bottom bar: what SPACE does right now (or why not) + the big on-screen button for touch. */
export function KeyHintBar({ action, isSpectator, onPress }: Props) {
  const enabled = action.action !== null;
  // Spectators get the big touch target; the active speaker's I'm-done button lives on their card.
  const showButton = isSpectator;
  return (
    <div className={`keyhint tile ${enabled ? 'is-on' : 'is-off'} ${action.action === 'done' ? 'keyhint--done' : ''}`}>
      <span className="keyhint__key">{!enabled && <LockIcon className="keyhint__lock" />}<kbd>SPACE</kbd>{action.label && <span>= {action.label}</span>}</span>
      {!enabled && 'reason' in action && <span className="keyhint__reason">{action.reason}</span>}
      {showButton && (
        <button className={`buzz-btn ${action.action === 'done' ? 'buzz-btn--done' : ''}`} onClick={onPress} disabled={!enabled}>
          {!enabled ? <LockIcon /> : action.action === 'done' ? <CheckIcon /> : <BellIcon />}
          {action.action === 'done' ? "I'm done" : 'Buzz'}
        </button>
      )}
    </div>
  );
}
