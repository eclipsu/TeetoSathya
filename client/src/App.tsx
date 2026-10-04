import { useState } from 'react';
import { SecureContextBanner } from './components/SecureContextBanner';
import { ToastProvider } from './components/Toasts';
import { matchBoard, matchRoom, usePath } from './lib/router';
import { getSession } from './lib/session';
import { Board } from './screens/Board';
import { Lobby } from './screens/Lobby';
import { NameEntry } from './screens/NameEntry';
import { RoomScreen } from './screens/RoomScreen';

export function App() {
  const path = usePath();
  const [hasName, setHasName] = useState(() => !!getSession().username);
  const [editingName, setEditingName] = useState(false);
  const roomId = matchRoom(path);
  // A second screen (projector, spectators) needs no name: it only reads SpacetimeDB.
  const boardId = matchBoard(path);

  const needName = !boardId && (!hasName || editingName);
  const screen = boardId
    ? <Board roomId={boardId} />
    : roomId && hasName
      ? <RoomScreen key={roomId} roomId={roomId} />
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
