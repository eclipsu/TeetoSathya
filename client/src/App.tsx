import { useState } from 'react';
import { SecureContextBanner } from './components/SecureContextBanner';
import { ToastProvider } from './components/Toasts';
import { matchRoom, usePath } from './lib/router';
import { getSession } from './lib/session';
import { Lobby } from './screens/Lobby';
import { NameEntry } from './screens/NameEntry';
import { RoomScreen } from './screens/RoomScreen';

export function App() {
  const path = usePath();
  const [hasName, setHasName] = useState(() => !!getSession().username);
  const [editingName, setEditingName] = useState(false);
  const roomId = matchRoom(path);

  let screen;
  if (!hasName || editingName) {
    // Entering a name is also the click that unlocks browser audio autoplay.
    screen = <NameEntry onDone={() => { setHasName(true); setEditingName(false); }} />;
  } else if (roomId) {
    screen = <RoomScreen roomId={roomId} />;
  } else {
    screen = <Lobby onChangeName={() => setEditingName(true)} />;
  }

  return (
    <ToastProvider>
      <SecureContextBanner />
      {screen}
    </ToastProvider>
  );
}
