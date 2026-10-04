import { nanoid } from 'nanoid';
import type { Room } from '../domain/model';
import { activeSpeaker, addJuryMessage, beginFactCheckCountdown, breakTie, canFactCheck, openTiebreak, dismissFactCheck, getRecentClaims, mergeClaims, openFactCheck, resolveFactCheck, setConsidering, setJuryPhase, setJuryThinking } from '../domain/factcheck';
import { DUMMY_SPEECH, probeClaimExtraction } from '../services/claimExtractor';
import { runJury } from '../services/factChecking/jury';
import { speakJurorLine } from '../services/elevenlabsTts';
import { HandlerError, type AppSocket, type RoomHub } from './hub';

/** Jurors look like they are thinking at least this long before a message lands. */
const THINK_MS = 2500;
/** Gap between two juror messages, so parallel answers read one after another. */
const MESSAGE_GAP_MS = 1400;
/** Time the client spends typing out the last message before the verdict shows. */
const TYPE_OUT_MS = 1800;
/** Pause after a juror finishes speaking before the next voice starts. */
const SPEAK_GAP_MS = 450;
/** Don't hold a message longer than this waiting for its audio; it goes out as text only. */
const VOICE_WAIT_MS = 6_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** Fact-check socket API. Rules live in domain/factcheck.ts; the jury runs after the room is paused. */
export function installFactCheckHandlers(hub: RoomHub) {
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

    // Read-only: the challenger browses claims while the debate keeps going.
    // Nothing pauses and no mic closes until they submit one.
    hub.handle(socket, 'factcheck:options', async (ack) => {
      if (typeof ack !== 'function') return;
      const room = await hub.requireRoom(socket);
      const gate = canFactCheck(room, socket.data.sessionId);
      if (!gate.ok) throw new HandlerError('invalid_state', gate.reason);
      const speaker = activeSpeaker(room);
      if (!speaker) throw new HandlerError('invalid_state', 'Nobody is speaking.');
      const claims = getRecentClaims(room, speaker.sessionId).map((c) => ({ id: c.id, text: c.text, createdAt: c.createdAt }));
      ack({ ok: true, claims, speakerId: speaker.id, speakerName: speaker.username });
    });

    // Shows "considering a challenge" next to the challenger. Nothing pauses.
    hub.handle(socket, 'factcheck:considering', async (p, ack) => {
      const room = await hub.requireRoom(socket);
      const on = p?.on === true;
      const out = await hub.store.update(room.id, (r) => ({ room: r, res: setConsidering(r, socket.data.sessionId, on) }));
      ack?.({ ok: true });
      if (out?.res) await hub.changed(out.room);
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

    hub.handle(socket, 'host:breakTie', async (p, ack) => {
      const room = await hub.requireHost(socket, p?.hostToken);
      const verdict = p?.verdict;
      if (verdict !== 'CORRECT' && verdict !== 'INCORRECT') throw new HandlerError('bad_request', 'Pick whether the claim stands.');
      const out = await hub.store.update(room.id, (r) => ({ room: r, res: breakTie(r, verdict, Date.now()) }));
      if (!out) throw new HandlerError('room_not_found', 'This room no longer exists.');
      if (!out.res.ok) throw new HandlerError('invalid_state', out.res.reason);
      hub.toastRoom(room.id, 'info', verdict === 'CORRECT' ? 'The host ruled: the claim stands.' : 'The host ruled: the claim is false.');
      ack?.({ ok: true });
      await hub.changed(out.room);
    });

    hub.handle(socket, 'factcheck:dismiss', async (p, ack) => {
      const room = await hub.requireHost(socket, p?.hostToken);
      const out = await hub.store.update(room.id, (r) => ({ room: r, res: dismissFactCheck(r, Date.now()) }));
      if (!out) throw new HandlerError('room_not_found', 'This room no longer exists.');
      if (!out.res.ok) throw new HandlerError('invalid_state', out.res.message);
      for (const t of out.res.toasts) hub.toastRoom(room.id, t.type, t.message);
      if (out.room.game.intermission === null && out.room.status === 'live') hub.toastRoom(room.id, 'info', 'Fact check dismissed. Clock running.');
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
  const current = await hub.store.get(roomId);
  // The round is about the opener's first claim: challenges are judged in that context.
  const roundClaim = current?.game.roundClaim?.text;
  // The motion is the topic. The round claim is background only: anything about the motion is on-topic,
  // not just claims about that one opening statement.
  const topic = current
    ? (roundClaim ? `${current.topic} (background: this round opened with the claim "${roundClaim}"; any claim about the motion is on-topic)` : current.topic)
    : '';
  const detailed = current?.settings.juryDetailed ?? false;
  let resolution: { verdict: 'CORRECT' | 'INCORRECT' | 'INCONCLUSIVE'; confidence: number; explanation: string; unavailable?: boolean; jury?: Awaited<ReturnType<typeof runJury>> | null };
  try {
    const push = async (apply: (room: Room) => boolean) => {
      const updated = await hub.store.update(roomId, (room: Room) => ({ room, res: apply(room) }));
      if (updated?.res) await hub.changed(updated.room);
    };
    // Room updates go out one at a time and paced: jurors "think" for a moment before each
    // message, and answers that arrive together are spread out so each one can be read.
    let thinkingSince = Date.now();
    let lastMessageAt = 0;
    /** When the juror currently speaking finishes. Voices never overlap. */
    let speakingUntil = 0;
    let queue: Promise<void> = Promise.resolve();
    const paced = (wait: () => number, apply: (room: Room) => boolean, after?: () => void) => {
      queue = queue.then(async () => {
        await sleep(wait());
        after?.();
        await push(apply);
      });
      return queue;
    };
    const jury = await runJury(claimId, claim, topic, {
      onPhase: (phase) => paced(() => 0, (room) => setJuryPhase(room, challengeId, phase)),
      onThinking: (models) => paced(() => lastMessageAt ? lastMessageAt + MESSAGE_GAP_MS - Date.now() : 0, (room) => setJuryThinking(room, challengeId, models), () => { thinkingSince = Date.now(); }),
      onMessage: (message) => {
        // Start the voice now, while the juror still looks like it is thinking.
        const voice = Promise.race([speakJurorLine(message.model, message.text), sleep(VOICE_WAIT_MS).then(() => null)]);
        const id = nanoid(8);
        queue = queue.then(async () => {
          await sleep(Math.max(thinkingSince + THINK_MS, lastMessageAt + MESSAGE_GAP_MS, speakingUntil + SPEAK_GAP_MS) - Date.now());
          const spoken = await voice;
          const audioMs = spoken?.durationMs ?? null;
          lastMessageAt = Date.now();
          speakingUntil = spoken ? lastMessageAt + spoken.durationMs : 0;
          await push((room) => addJuryMessage(room, challengeId, { ...message, id, at: lastMessageAt, audioMs }));
          if (spoken) hub.io.to(roomId).emit('jury:voice', { checkId: challengeId, messageId: id, model: message.model, audio: spoken.audio, durationMs: spoken.durationMs });
        });
        return queue;
      },
    }, detailed);
    await queue;
    // Let the last message finish typing out (and being spoken) before the verdict lands.
    await sleep(Math.max(lastMessageAt + TYPE_OUT_MS, speakingUntil + SPEAK_GAP_MS) - Date.now());
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
  // Split jury: the room argues (hold P) and the host decides; no verdict, no countdown yet.
  if (resolution.jury && !resolution.jury.verdict && !resolution.unavailable) {
    const jury = resolution.jury;
    const split = await hub.store.update(roomId, (room: Room) => ({ room, res: openTiebreak(room, challengeId, jury) }));
    if (!split?.res) return;
    const host = split.room.participants.get(split.room.hostSessionId)?.username ?? 'The host';
    hub.toastRoom(roomId, 'warn', `The jury split. Hold P to argue your case. ${host} decides.`);
    await hub.changed(split.room);
    return;
  }
  // The verdict holds the stage for FACT_CHECK_RESUME_MS, then the game timer resumes the clocks.
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
