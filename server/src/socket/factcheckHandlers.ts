import { nanoid } from 'nanoid';
import type { Room } from '../domain/model';
import { activeSpeaker, armFactCheck, beginFactCheckCountdown, canFactCheck, disarmFactCheck, dismissFactCheck, getRecentClaims, mergeClaims, openFactCheck, resolveFactCheck, setJuryPhase } from '../domain/factcheck';
import { DUMMY_SPEECH, probeClaimExtraction } from '../services/claimExtractor';
import { runJury } from '../services/factChecking/jury';
import type { Transcription } from '../services/transcription';
import { HandlerError, type AppSocket, type RoomHub } from './hub';

const FLUSH_WAIT_MS = 14_000;

/** Fact-check socket API. Rules live in domain/factcheck.ts; the jury runs after the room is paused. */
export function installFactCheckHandlers(hub: RoomHub, transcription: Transcription) {
  hub.io.on('connection', (socket: AppSocket) => {
    // TEMP: click-to-test claim extraction. Delete with the button.
    hub.handle(socket, 'claims:demo', async (ack) => {
      const room = await hub.requireRoom(socket);
      if (room.status !== 'live') throw new HandlerError('invalid_state', 'Start the round first.');
      const speaker = activeSpeaker(room) ?? room.participants.get(socket.data.sessionId) ?? null;
      if (!speaker || speaker.team === null) throw new HandlerError('invalid_state', 'Take a seat on a side first.');
      const probe = await probeClaimExtraction(DUMMY_SPEECH);
      const claims = probe.claude.ok ? probe.claude.claims : probe.gemini.claims;
      if (claims.length) {
        const now = Date.now();
        const updated = await hub.store.update(room.id, (r) => {
          mergeClaims(r, claims.map((text) => ({
            id: nanoid(10),
            text,
            originalText: text,
            speakerSessionId: speaker.sessionId,
            team: speaker.team!,
            createdAt: now,
          })));
          return { room: r, res: true };
        });
        if (updated) await hub.changed(updated.room);
      }
      const line = (side: { ok: boolean; claims: string[]; error: string | null }) => side.ok ? side.claims.join(' · ') || 'No claims found.' : side.error ?? 'Failed.';
      ack?.({ ok: true, gemini: line(probe.gemini), claude: line(probe.claude), claims });
    });

    hub.handle(socket, 'factcheck:options', async (ack) => {
      if (typeof ack !== 'function') return;
      const room = await hub.requireRoom(socket);
      const armed = await hub.store.update(room.id, (r) => ({ room: r, res: armFactCheck(r, socket.data.sessionId, Date.now()) }));
      if (!armed) throw new HandlerError('room_not_found', 'This room no longer exists.');
      if (!armed.res.ok) throw new HandlerError('invalid_state', armed.res.reason);
      await hub.changed(armed.room);
      hub.toastRoom(room.id, 'warn', `${armed.res.challengerName} called a fact check.`);
      const held = activeSpeaker(armed.room);
      if (held) toastOne(hub, room.id, held.sessionId, 'warn', 'Fact check. Your microphone is off.');
      try {
        await Promise.race([
          transcription.flushCurrent(armed.room),
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
      } catch (err) {
        const rolled = await hub.store.update(room.id, (r) => {
          disarmFactCheck(r, socket.data.sessionId, Date.now());
          return { room: r, res: true };
        });
        if (rolled) await hub.changed(rolled.room);
        throw err;
      }
    });

    hub.handle(socket, 'factcheck:cancel', async (ack) => {
      const room = await hub.requireRoom(socket);
      const out = await hub.store.update(room.id, (r) => {
        disarmFactCheck(r, socket.data.sessionId, Date.now());
        return { room: r, res: true };
      });
      if (out) await hub.changed(out.room);
      ack?.({ ok: true });
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

function toastOne(hub: RoomHub, roomId: string, sessionId: string, type: 'warn' | 'info', message: string): void {
  for (const entry of hub.io.sockets.sockets.values()) {
    const sock = entry as AppSocket;
    if (sock.data.roomId === roomId && sock.data.sessionId === sessionId) sock.emit('toast', { type, message });
  }
}

function safeJuryError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'jury failed';
  if (/api[_-]?key|sk-|AIza|bearer /i.test(message)) return 'provider request failed';
  return message.slice(0, 180);
}

async function judge(hub: RoomHub, roomId: string, challengeId: string, claimId: string, claim: string): Promise<void> {
  let resolution: { verdict: 'CORRECT' | 'INCORRECT' | 'INCONCLUSIVE'; confidence: number; explanation: string; unavailable?: boolean; jury?: Awaited<ReturnType<typeof runJury>> | null };
  const topic = (await hub.store.get(roomId))?.topic ?? '';
  try {
    const jury = await runJury(claimId, claim, topic, async (phase) => {
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
        explanation: jury.offTopic ? 'Different and incorrect' : `${jury.votesForCorrect}–${jury.votesForIncorrect} ${jury.verdict}`,
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
  const updated = await hub.store.update(roomId, (room: Room) => {
    const res = resolveFactCheck(room, challengeId, resolution);
    if (res.ok) beginFactCheckCountdown(room, Date.now());
    return { room, res };
  });
  if (!updated?.res.ok) return;
  try {
    await hub.changed(updated.room);
  } catch (err) {
    console.error('[factcheck] broadcast failed', err);
  }
}
