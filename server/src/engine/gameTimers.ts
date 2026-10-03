import type { Room } from '../domain/model';
import { nextDeadline, tick } from '../domain/game';
import type { RoomHub } from '../socket/hub';

/**
 * One timeout per room, aimed at the next deadline (active clock hitting 0 or round end).
 * Re-armed after every room change, so it never depends on broadcast frequency.
 */
export function installGameTimers(hub: RoomHub) {
  const timers = new Map<string, { at: number; t: NodeJS.Timeout }>();

  const arm = (room: Room) => {
    const at = nextDeadline(room);
    const cur = timers.get(room.id);
    if (cur && cur.at === at) return;
    if (cur) clearTimeout(cur.t);
    timers.delete(room.id);
    if (at === null) return;
    const t = setTimeout(() => void fire(room.id), Math.max(0, at - Date.now()) + 5);
    timers.set(room.id, { at, t });
  };

  const fire = async (roomId: string) => {
    timers.delete(roomId);
    const out = await hub.store.update(roomId, (room) => ({ room, res: tick(room, Date.now()) }));
    if (!out) return;
    if (out.res.ok) for (const t of out.res.toasts) hub.toastRoom(roomId, t.type, t.message);
    await hub.changed(out.room); // re-arms via the change hook
  };

  hub.onRoomChange(arm);
  hub.onRoomClosed((roomId) => {
    const cur = timers.get(roomId);
    if (cur) clearTimeout(cur.t);
    timers.delete(roomId);
  });
}
