import { nanoid } from 'nanoid';
import type { TeamIndex } from '@teeto/shared';
import { config } from '../config';
import { appendTranscript, mergeClaims } from '../domain/factcheck';
import type { Room } from '../domain/model';
import type { AppSocket, RoomHub } from '../socket/hub';
import { extractClaims } from './claimExtractor';
import { ElevenLabsSession } from './elevenlabsStt';

interface SpeakerTarget {
  roomId: string;
  roundSeq: number;
  sessionId: string;
  publicId: string;
  team: TeamIndex;
}

function targetOf(room: Room): SpeakerTarget | null {
  if (room.status !== 'live') return null;
  const g = room.game;
  if (g.paused || g.buzz || g.activeFactCheckId || g.activeSide === null || g.clockRunningSince === null) return null;
  const sessionId = g.hotSeat[g.activeSide];
  if (!sessionId) return null;
  const p = room.participants.get(sessionId);
  if (!p || p.team === null) return null;
  return { roomId: room.id, roundSeq: g.roundSeq, sessionId, publicId: p.id, team: p.team };
}

function targetKey(t: SpeakerTarget): string {
  return `${t.roomId}:${t.roundSeq}:${t.sessionId}`;
}

function asPcm(payload: unknown): Buffer | null {
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof Uint8Array) return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  if (payload instanceof ArrayBuffer) return Buffer.from(payload);
  return null;
}

/**
 * Pipes the active hot-seat speaker's audio to ElevenLabs and turns finalized
 * segments into that speaker's claims. Identity comes from game state, not from
 * the audio packet. Lobby, spectators, and the listening team are never transcribed.
 */
export class Transcription {
  private desired = new Map<string, SpeakerTarget | null>();
  private sessions = new Map<string, { target: SpeakerTarget; stt: ElevenLabsSession; retiring: boolean }>();
  private pending = new Map<string, string>();
  private partials = new Map<string, string>();
  private partialTimers = new Map<string, NodeJS.Timeout>();
  private uttered = new Map<string, string>();
  private meta = new Map<string, SpeakerTarget>();
  private audioLogged = new Set<string>();
  private chains = new Map<string, Promise<void>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private retry = new Map<string, NodeJS.Timeout>();
  private retryCount = new Map<string, number>();
  private fatal = new Set<string>();
  private audioWindow = new Map<string, { t: number; n: number }>();

  constructor(private readonly hub: RoomHub) {}

  /** Follow the hot seat. Closing a turn commits and extracts; it does not delete that speaker's claims. */
  sync(room: Room): void {
    const next = targetOf(room);
    this.desired.set(room.id, next);
    const cur = this.sessions.get(room.id);
    const same = !!cur && !!next && cur.target.sessionId === next.sessionId && cur.target.roundSeq === next.roundSeq && !cur.retiring;
    if (same) return;
    if (cur) void this.retire(room.id, cur);
    if (next) this.open(next);
    else this.hub.io.to(room.id).emit('transcript:interim', { speakerId: '', text: '' });
  }

  drop(roomId: string): void {
    this.desired.delete(roomId);
    const cur = this.sessions.get(roomId);
    this.sessions.delete(roomId);
    cur?.stt.close();
    this.clearRetry(roomId);
    for (const key of this.pending.keys()) if (key.startsWith(roomId + ':')) this.pending.delete(key);
  }

  /**
   * Audio from the browser that is publishing the LiveKit mic track.
   * Dropped unless that socket is the current hot-seat speaker.
   */
  acceptAudio(sessionId: string, roomId: string | undefined, payload: unknown): void {
    if (!roomId) return;
    const pcm = asPcm(payload);
    if (!pcm || pcm.length < 2 || pcm.length > 64_000) {
      if (!this.audioLogged.has(roomId + ':bad')) {
        this.audioLogged.add(roomId + ':bad');
        const kind = payload === null || payload === undefined ? 'empty' : (payload as { constructor?: { name?: string } }).constructor?.name ?? typeof payload;
        console.warn(`[stt] ${roomId}: microphone packet ignored (${kind})`);
      }
      return;
    }
    const now = Date.now();
    const window = this.audioWindow.get(roomId) ?? { t: now, n: 0 };
    if (now - window.t > 1000) { window.t = now; window.n = 0; }
    window.n += 1;
    this.audioWindow.set(roomId, window);
    if (window.n > 30) return;
    const cur = this.sessions.get(roomId);
    if (!cur || cur.retiring || cur.target.sessionId !== sessionId) return;
    if (!this.audioLogged.has(roomId)) {
      this.audioLogged.add(roomId);
      console.log(`[stt] ${roomId}: microphone audio is reaching transcription`);
    }
    cur.stt.sendPcm(pcm);
  }

  /** Commit in-flight speech and run claim extraction before the claim picker answers. */
  async flushCurrent(room: Room): Promise<void> {
    const cur = this.sessions.get(room.id);
    const target = (cur && !cur.retiring ? cur.target : null) ?? targetOf(room) ?? cur?.target ?? null;
    if (!target) return;
    if (cur && !cur.retiring && cur.target.sessionId === target.sessionId) {
      await this.retire(room.id, cur);
      return;
    }
    const key = targetKey(target);
    this.meta.set(key, target);
    await this.drain(key);
    await this.drain(key);
  }

  private open(target: SpeakerTarget): void {
    if (!config.elevenLabsApiKey || this.fatal.has(target.roomId)) {
      this.hub.io.to(target.roomId).emit('transcript:status', { available: false });
      return;
    }
    const stt = new ElevenLabsSession({
      onPartial: (text) => {
        this.hub.io.to(target.roomId).emit('transcript:interim', { speakerId: target.publicId, text });
        const key = targetKey(target);
        this.partials.set(key, text);
        this.armPartial(key, target);
      },
      onCommitted: (text) => this.onCommitted(target, text),
      onOpen: () => {
        this.retryCount.set(target.roomId, 0);
        this.hub.io.to(target.roomId).emit('transcript:status', { available: true });
      },
      onDown: (message, fatal) => {
        console.warn(`[stt] ${target.roomId}: ${message}`);
        if (message.startsWith('input_error')) return;
        this.takePartial(target);
        this.hub.io.to(target.roomId).emit('transcript:status', { available: false });
        if (fatal) {
          this.fatal.add(target.roomId);
          return;
        }
        const cur = this.sessions.get(target.roomId);
        if (cur && !cur.retiring && cur.target.sessionId === target.sessionId && cur.target.roundSeq === target.roundSeq) {
          this.scheduleRetry(target);
        }
      },
    });
    this.sessions.set(target.roomId, { target, stt, retiring: false });
    this.meta.set(targetKey(target), target);
    stt.start();
  }

  private async retire(roomId: string, cur: { target: SpeakerTarget; stt: ElevenLabsSession; retiring: boolean }): Promise<void> {
    if (cur.retiring) return;
    cur.retiring = true;
    if (this.sessions.get(roomId) === cur) this.sessions.delete(roomId);
    const key = targetKey(cur.target);
    this.takePartial(cur.target);
    try { await cur.stt.commitAndWait(1500); } catch (err) { console.warn('[stt] commit failed:', (err as Error).message); }
    cur.stt.close();
    await this.drain(key);
  }

  /** A partial that has stopped growing is the transcript. VAD only commits after silence, and a dropped socket never commits. */
  private armPartial(key: string, target: SpeakerTarget): void {
    const existing = this.partialTimers.get(key);
    if (existing) clearTimeout(existing);
    this.partialTimers.set(key, setTimeout(() => {
      this.partialTimers.delete(key);
      this.takePartial(target);
    }, 1200));
  }

  private takePartial(target: SpeakerTarget): void {
    const key = targetKey(target);
    const timer = this.partialTimers.get(key);
    if (timer) clearTimeout(timer);
    this.partialTimers.delete(key);
    const text = (this.partials.get(key) ?? '').trim();
    this.partials.delete(key);
    if (text) this.onCommitted(target, text);
  }

  private onCommitted(target: SpeakerTarget, text: string): void {
    const key = targetKey(target);
    const timer = this.partialTimers.get(key);
    if (timer) clearTimeout(timer);
    this.partialTimers.delete(key);
    this.partials.delete(key);
    const prev = this.uttered.get(key) ?? '';
    let addition = text.trim();
    if (!addition) return;
    if (prev && (addition === prev || prev.endsWith(addition))) return;
    if (prev && addition.startsWith(prev)) addition = addition.slice(prev.length).trim();
    if (!addition) {
      this.uttered.set(key, text.trim());
      return;
    }
    this.uttered.set(key, prev ? `${prev} ${addition}`.trim().slice(-4000) : addition);
    text = addition;
    this.meta.set(key, target);
    void this.hub.store.update(target.roomId, (room) => {
      appendTranscript(room, {
        id: nanoid(10),
        roomId: target.roomId,
        speakerSessionId: target.sessionId,
        team: target.team,
        text,
        at: Date.now(),
        roundSeq: target.roundSeq,
      });
      return null;
    });
    const combined = `${this.pending.get(key) ?? ''} ${text}`.trim().slice(-4000);
    this.pending.set(key, combined);
    this.hub.io.to(target.roomId).emit('transcript:interim', { speakerId: target.publicId, text: '' });
    if (combined.length >= 240) {
      this.clearTimer(key);
      void this.enqueue(key, () => this.extractPending(key));
    } else this.schedule(key);
  }

  private schedule(key: string): void {
    this.clearTimer(key);
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      void this.enqueue(key, () => this.extractPending(key));
    }, 700));
  }

  private async drain(key: string): Promise<void> {
    this.clearTimer(key);
    await this.enqueue(key, () => this.extractPending(key, true));
    await this.enqueue(key, () => this.extractPending(key, true));
  }

  private enqueue(key: string, job: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(job, job);
    this.chains.set(key, next.then(() => undefined, () => undefined));
    return next;
  }

  private async extractPending(key: string, force = false): Promise<void> {
    const text = (this.pending.get(key) ?? '').trim();
    if (!text || (!force && text.length < 8)) return;
    this.pending.set(key, '');
    const meta = this.meta.get(key);
    if (!meta) return;
    let drafts;
    try {
      drafts = await extractClaims(text, AbortSignal.timeout(22_000));
    } catch (err) {
      console.warn('[claims] extraction failed:', (err as Error).message);
      const newer = this.pending.get(key) ?? '';
      this.pending.set(key, `${text} ${newer}`.trim().slice(-4000));
      return;
    }
    if (!drafts.length) return;
    const now = Date.now();
    await this.hub.store.update(meta.roomId, (room) => {
      if (room.status !== 'live' || room.game.roundSeq !== meta.roundSeq) return null;
      const added = mergeClaims(room, drafts.map((d) => ({
        id: nanoid(10),
        text: d.text,
        originalText: d.originalText,
        speakerSessionId: meta.sessionId,
        team: meta.team,
        createdAt: now,
      })));
      if (added.length) console.log(`[claims] ${meta.publicId} +${added.length}`);
      return null;
    });
  }

  private scheduleRetry(target: SpeakerTarget): void {
    if (this.retry.has(target.roomId)) return;
    const n = (this.retryCount.get(target.roomId) ?? 0) + 1;
    this.retryCount.set(target.roomId, n);
    const delay = Math.min(8000, 1000 * 2 ** Math.min(n, 3));
    this.retry.set(target.roomId, setTimeout(() => {
      this.retry.delete(target.roomId);
      const want = this.desired.get(target.roomId);
      if (!want || want.sessionId !== target.sessionId || want.roundSeq !== target.roundSeq) return;
      if (this.fatal.has(target.roomId)) return;
      const cur = this.sessions.get(target.roomId);
      cur?.stt.close();
      this.sessions.delete(target.roomId);
      this.open(want);
    }, delay));
  }

  private clearTimer(key: string): void {
    const t = this.timers.get(key);
    if (t) clearTimeout(t);
    this.timers.delete(key);
  }

  private clearRetry(roomId: string): void {
    const t = this.retry.get(roomId);
    if (t) clearTimeout(t);
    this.retry.delete(roomId);
  }
}

export function installTranscription(hub: RoomHub): Transcription {
  const transcription = new Transcription(hub);
  hub.onRoomChange((room) => transcription.sync(room));
  hub.onRoomClosed((roomId) => transcription.drop(roomId));
  hub.io.on('connection', (socket) => {
    const s = socket as AppSocket;
    s.on('transcript:audio', (payload: unknown) => {
      transcription.acceptAudio(s.data.sessionId, s.data.roomId, payload);
    });
  });
  return transcription;
}
