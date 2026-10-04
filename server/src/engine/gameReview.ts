import { nanoid } from 'nanoid';
import type { JuryModel, RoundWinner } from '@teeto/shared';
import type { Room } from '../domain/model';
import { playerStats } from '../domain/review';
import { resultLine, writeReview } from '../services/reviewer';
import { speakJurorLine } from '../services/elevenlabsTts';
import type { RoomHub } from '../socket/hub';

/** Let the winner chime and confetti land before the first voice. */
const START_DELAY_MS = 2_500;
const LINE_GAP_MS = 450;
/** Without audio, a line stays up this long before the next appears. */
const TEXT_ONLY_MS = 2_200;
const VOICES: JuryModel[] = ['gemini', 'claude'];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/**
 * When a game ends: stat cards go up at once, then Gemini and Claude take turns reading a short
 * review and announcing the result. Runs in the background; the summary screen fills in as it goes.
 */
export function installGameReview(hub: RoomHub) {
  const running = new Set<string>();
  /** Result already announced per room (so a host tie-break gets exactly one extra line). */
  const announced = new Map<string, RoundWinner | null>();

  const appendLine = async (roomId: string, model: JuryModel, text: string, voice: { audio: Buffer; durationMs: number } | null, status: 'speaking' | 'done') => {
    const id = nanoid(8);
    const out = await hub.store.update(roomId, (r: Room) => {
      if (r.status !== 'ended' || !r.game.review) return { room: r, res: false };
      r.game.review.lines.push({ id, model, text, audioMs: voice?.durationMs ?? null });
      r.game.review.status = status;
      return { room: r, res: true };
    });
    if (!out?.res) return false;
    await hub.changed(out.room);
    if (voice) hub.io.to(roomId).emit('jury:voice', { checkId: 'review', messageId: id, model, audio: voice.audio, durationMs: voice.durationMs });
    await sleep((voice?.durationMs ?? TEXT_ONLY_MS) + LINE_GAP_MS);
    return true;
  };

  hub.onRoomChange((room: Room) => {
    if (room.status !== 'ended') return;
    const g = room.game;

    // Host broke a tie after the review: one more line with the decision.
    if (g.review?.status === 'done' && announced.has(room.id) && announced.get(room.id) === null && g.winner !== null) {
      announced.set(room.id, g.winner);
      const text = resultLine({ topic: room.topic, sides: room.sides, scores: g.scores, winner: g.winner });
      const model = VOICES[g.review.lines.length % 2]!;
      void speakJurorLine(model, text).then((voice) => appendLine(room.id, model, text, voice, 'done'));
      return;
    }

    if (g.review || running.has(room.id)) return;
    running.add(room.id);
    const endedAt = Date.now();
    void (async () => {
      try {
        const players = playerStats(room);
        const ctx = { topic: room.topic, sides: room.sides, scores: [g.scores[0], g.scores[1]] as [number, number], winner: g.winner };
        const started = await hub.store.update(room.id, (r: Room) => {
          if (r.status !== 'ended' || r.game.review) return { room: r, res: false };
          r.game.review = { status: 'writing', players, lines: [] };
          return { room: r, res: true };
        });
        if (!started?.res) return;
        await hub.changed(started.room);

        const script = await writeReview(players, ctx);
        // Voice every line at once (alternating jurors), then play them in order.
        const voices = await Promise.all(script.map((text, i) => speakJurorLine(VOICES[i % 2]!, text)));
        await sleep(endedAt + START_DELAY_MS - Date.now());
        for (let i = 0; i < script.length; i++) {
          const ok = await appendLine(room.id, VOICES[i % 2]!, script[i]!, voices[i] ?? null, i === script.length - 1 ? 'done' : 'speaking');
          if (!ok) return;
        }
        announced.set(room.id, ctx.winner);
      } catch (err) {
        console.warn('[review] failed:', err instanceof Error ? err.message : 'error');
      } finally {
        running.delete(room.id);
      }
    })();
  });

  hub.onRoomClosed((roomId) => { announced.delete(roomId); });
}
