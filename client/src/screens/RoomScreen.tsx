import { ArrowLeftIcon } from '../components/icons';
import { navigate } from '../lib/router';

// Placeholder until checkpoint C wires up live room state.
export function RoomScreen({ roomId }: { roomId: string }) {
  return (
    <main className="placeholder">
      <h1 className="logo">Room {roomId}</h1>
      <p className="muted">Live room arrives in checkpoint C.</p>
      <button className="btn btn--ghost" onClick={() => navigate('/')}><ArrowLeftIcon /> Back to rooms</button>
    </main>
  );
}
