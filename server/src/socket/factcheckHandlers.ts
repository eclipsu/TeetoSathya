import { nanoid } from 'nanoid';
import type { Room } from '../domain/model';
import { activeSpeaker, canFactCheck, dismissFactCheck, getRecentClaims, openFactCheck, resolveFactCheck, setJuryPhase } from '../domain/factcheck';
import { runJury } from '../services/factChecking/jury';
import type { Transcription } from '../services/transcription';
import { HandlerError, type AppSocket, type RoomHub } from './hub';

const FLUSH_WAIT_MS = 14_000;

/** Fact-check socket API. Rules live in domain/factcheck.ts; the jury runs after the room is paused. */
export function installFactCheckHandlers(hub: RoomHub, transcription: Transcription) {
  hub.io.on('connection', (socket: AppSocket) => {
    hub.handle(socket, 'factcheck:options', async (ack) => {
      if (typeof ack !== 'function') return;
      const room = await hub.requireRoom(socket);
      const gate = canFactCheck(room, socket.data.sessionId);
      if (!gate.ok) throw new HandlerError('invalid_state', gate.reason);
      await Promise.race([
        transcription.flushCurrent(room),
        new Promise<void>((resolve) => setTimeout(resolve, FLUSH_WAIT_MS)),
      ]);
      const fresh = await hub.store.get(room.id);
      if (!fresh) throw new HandlerError('room_not_found', 'This room no longer exists.');
      const again = canFactCheck(fresh, socket.data.sessionId);
      if (!again.ok) throw new HandlerError('invalid_state', again.reason);
      const speaker = activeSpeaker(fresh);
      if (!speaker) throw new HandlerError('invalid_state', 'Nobody is speaking.');
      const claims = getRecentClaims(fresh, speaker.sessionId, 4).map((c) => ({ id: c.id, text: c.text, createdAt: c.createdAt }));
      ack({ ok: true, claims, speakerId: speaker.id, speakerName: speaker.username });
    });

    hub.handle(socket, 'factcheck:submit', async (p, ack) => {
      const room = await hub.requireRoom(socket);
      const claimId = p?.claimId;
      if (typeof claimId !== 'string' || !claimId) throw new HandlerError('bad_request', 'Pick a claim first.');
      const out = await hub.store.update(room.id, (r) => ({
        room: r,
        res: openFactCheck(r, socket.data.sessionId, claimId, Date.now(), nanoid(12)),
      }));
      if (!out) throw new HandlerError('room_not_found', 'This room no longer exists.');
      if (!out.res.ok) throw new HandlerError('invalid_state', out.res.reason);
      const challenge = out.res.challenge;
      ack?.({ ok: true });
      hub.toastRoom(room.id, 'warn', `${challenge.challengerName} challenged ${challenge.speakerName}.`);
      await hub.changed(out.room);
      void judge(hub, room.id, challenge.id, challenge.claimId, challenge.claim);
    });

    hub.handle(socket, 'factcheck:dismiss', async (p, ack) => {
      const room = await hub.requireHost(socket, p?.hostToken);
      const out = await hub.store.update(room.id, (r) => ({ room: r, res: dismissFactCheck(r, Date.now()) }));
      if (!out) throw new HandlerError('room_not_found', 'This room no longer exists.');
      if (!out.res.ok) throw new HandlerError('invalid_state', out.res.message);
      hub.toastRoom(room.id, 'info', 'Fact check dismissed. Clock running.');
      ack?.({ ok: true });
      await hub.changed(out.room);
    });
  });
}

function safeJuryError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'jury failed';
  if (/api[_-]?key|sk-|AIza|bearer /i.test(message)) return 'provider request failed';
  return message.slice(0, 180);
}

async function judge(hub: RoomHub, roomId: string, challengeId: string, claimId: string, claim: string): Promise<void> {
  let resolution: { verdict: 'CORRECT' | 'INCORRECT' | 'INCONCLUSIVE'; confidence: number; explanation: string; unavailable?: boolean; jury?: Awaited<ReturnType<typeof runJury>> | null };
  try {
    const jury = await runJury(claimId, claim, async (phase) => {
      try {
        const updated = await hub.store.update(roomId, (room: Room) => ({
          room,
          res: setJuryPhase(room, challengeId, phase),
        }));
        if (updated?.res) await hub.changed(updated.room);
      } catch (err) {
        console.warn('[jury] phase broadcast failed:', safeJuryError(err));
      }
    });
    resolution = jury.verdict
      ? {
        verdict: jury.verdict,
        confidence: jury.juryConfidence,
        explanation: `${jury.votesForCorrect}–${jury.votesForIncorrect} ${jury.verdict}`,
        jury,
      }
      : {
        verdict: 'INCONCLUSIVE',
        confidence: 0,
        explanation: 'The seated jurors split.',
        jury,
      };
  } catch (err) {
    console.warn('[jury] failed:', safeJuryError(err));
    resolution = { verdict: 'INCONCLUSIVE', confidence: 0, explanation: 'JURY ERROR', unavailable: true, jury: null };
  }
  const updated = await hub.store.update(roomId, (room: Room) => ({
    room,
    res: resolveFactCheck(room, challengeId, resolution),
  }));
  if (!updated?.res.ok) return;
  try {
    await hub.changed(updated.room);
  } catch (err) {
    console.error('[factcheck] broadcast failed', err);
  }
}
