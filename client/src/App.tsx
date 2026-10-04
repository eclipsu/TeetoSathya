import { useState } from 'react';
import { SecureContextBanner } from './components/SecureContextBanner';
import { ToastProvider } from './components/Toasts';
import { matchRoom, usePath } from './lib/router';
import { getSession } from './lib/session';
import { History } from './screens/History';
import { Lobby } from './screens/Lobby';
import { NameEntry } from './screens/NameEntry';
import { RoomScreen } from './screens/RoomScreen';

export function App() {
  const path = usePath();
  const [hasName, setHasName] = useState(() => !!getSession().username);
  const [editingName, setEditingName] = useState(false);
  const roomId = matchRoom(path);

  const needName = !hasName || editingName;
  const screen = roomId && hasName
    ? <RoomScreen key={roomId} roomId={roomId} />
    : path === '/history' && hasName
      ? <History />
      : <Lobby onChangeName={() => setEditingName(true)} />;

  return (
    <ToastProvider>
      <SecureContextBanner />
      {screen}
      {needName && (
        <NameEntry
          onDone={() => { setHasName(true); setEditingName(false); }}
          onCancel={hasName ? () => setEditingName(false) : undefined}
        />
      )}
    </ToastProvider>
  );
}
