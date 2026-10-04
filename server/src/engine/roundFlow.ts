import type { Room } from '../domain/model';
import { beginIntro, startNextRound } from '../domain/game';
import { announceRound } from '../services/announcer';
import type { RoomHub } from '../socket/hub';

/** Small gap after the announcement before the opener's clock starts. */
const INTRO_TAIL_MS = 500;

/**
 * Between rounds: write and voice the next round's announcement during the break, then start the
 * round with it playing. If this is slow, the game timer starts the round without it
 * (INTERMISSION_GRACE_MS), and the late announcement is dropped.
 */
export function installRoundFlow(hub: RoomHub) {
  const preparing = new Set<string>();

  hub.onRoomChange((room: Room) => {
    const im = room.game.intermission;
    if (room.status !== 'live' || !im) return;
    const key = `${room.id}:${im.nextRound}`;
    if (preparing.has(key)) return;
    preparing.add(key);
    void (async () => {
      try {
        const opener = im.openerSessionId ? room.participants.get(im.openerSessionId)?.username ?? null : null;
        const intro = await announceRound(room.topic, room.sides, opener, im.nextRound, room.settings.totalRounds, im.openingSide);
        const wait = im.until - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        const out = await hub.store.update(room.id, (r) => {
          // Only if this break is still the one we prepared for (not ended, not already started).
          if (r.status !== 'live' || r.game.intermission?.nextRound !== im.nextRound) return { room: r, res: null };
          const now = Date.now();
          const res = startNextRound(r, now);
          if (res.ok && intro.voice) beginIntro(r, now, intro.text, intro.voice.durationMs + INTRO_TAIL_MS);
          return { room: r, res };
        });
        if (!out?.res?.ok) return;
        for (const t of out.res.toasts) hub.toastRoom(room.id, t.type, t.message);
        await hub.changed(out.room);
        if (intro.voice) hub.io.to(room.id).emit('room:announce', { text: intro.text, audio: intro.voice.audio, durationMs: intro.voice.durationMs });
      } catch (err) {
        console.warn('[rounds] next round start failed:', err instanceof Error ? err.message : 'error');
      } finally {
        preparing.delete(key);
      }
    })();
  });
}
