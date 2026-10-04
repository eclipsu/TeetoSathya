import WebSocket from 'ws';
import { config } from '../config';

export interface SttHandlers {
  onPartial: (text: string) => void;
  onCommitted: (text: string) => void;
  onOpen: () => void;
  onDown: (message: string, fatal: boolean) => void;
}

/**
 * One ElevenLabs realtime session. Audio is PCM16 mono. Committed text is final;
 * partial text is interim only and must not be stored as transcript.
 */
export class ElevenLabsSession {
  private ws: WebSocket | null = null;
  private sentAudio = false;
  private ready = false;
  private chunksSent = 0;
  private queued: Buffer[] = [];
  private commitWait: (() => void) | null = null;
  private closed = false;

  constructor(private readonly handlers: SttHandlers) {}

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  start(): void {
    if (!config.elevenLabsApiKey) {
      this.handlers.onDown('ELEVENLABS_API_KEY is not set.', true);
      return;
    }
    const url = new URL('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
    url.searchParams.set('model_id', 'scribe_v2_realtime');
    url.searchParams.set('audio_format', 'pcm_16000');
    url.searchParams.set('commit_strategy', 'vad');
    url.searchParams.set('vad_silence_threshold_secs', '0.6');
    url.searchParams.set('language_code', 'en');
    const ws = new WebSocket(url, { headers: { 'xi-api-key': config.elevenLabsApiKey } });
    this.ws = ws;
    ws.on('open', () => this.handlers.onOpen());
    ws.on('message', (data) => this.onMessage(data.toString()));
    ws.on('error', (err) => {
      if (!this.closed) this.handlers.onDown(err.message, false);
    });
    ws.on('close', (code, reason) => {
      const why = reason.length ? ` ${reason.toString().slice(0, 120)}` : '';
      if (!this.closed) this.handlers.onDown(`ElevenLabs connection closed (${code}${why}, audio=${this.chunksSent}).`, false);
      this.commitWait?.();
      this.commitWait = null;
    });
  }

  sendPcm(pcm: Buffer): void {
    if (this.closed) return;
    if (!this.ready || !this.open) {
      this.queued.push(pcm);
      if (this.queued.length > 20) this.queued.shift();
      return;
    }
    this.writePcm(pcm);
  }

  private writePcm(pcm: Buffer): void {
    if (!this.open) return;
    this.sentAudio = true;
    this.chunksSent += 1;
    this.ws!.send(JSON.stringify({
      message_type: 'input_audio_chunk',
      audio_base_64: pcm.toString('base64'),
      commit: false,
      sample_rate: 16000,
    }));
  }

  /**
   * Wait for VAD to commit buffered speech. This session uses commit_strategy=vad,
   * which rejects a manual commit message.
   */
  commitAndWait(ms: number): Promise<void> {
    if (!this.open || !this.sentAudio) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.commitWait = null;
        resolve();
      }, ms);
      this.commitWait = () => {
        clearTimeout(timer);
        this.commitWait = null;
        resolve();
      };
    });
  }

  close(): void {
    this.closed = true;
    this.commitWait?.();
    this.commitWait = null;
    try { this.ws?.close(); } catch { /* already gone */ }
    this.ws = null;
  }

  private onMessage(raw: string): void {
    let msg: { message_type?: string; text?: string; transcript?: string; error?: unknown };
    try { msg = JSON.parse(raw) as { message_type?: string; text?: string; transcript?: string; error?: unknown }; } catch { return; }
    const type = msg.message_type ?? '';
    const text = String(msg.text ?? msg.transcript ?? '').trim();
    if (type === 'partial_transcript') {
      if (text) this.handlers.onPartial(text);
      return;
    }
    if (type === 'committed_transcript' || type === 'committed_transcript_with_timestamps') {
      if (text) this.handlers.onCommitted(text);
      this.commitWait?.();
      return;
    }
    if (type === 'session_started') {
      this.ready = true;
      const queued = this.queued;
      this.queued = [];
      for (const pcm of queued) this.writePcm(pcm);
      return;
    }
    if (!type || type === 'error' || type.endsWith('_error') || type.endsWith('_exceeded') || type === 'rate_limited' || type === 'invalid_request' || type === 'insufficient_audio_activity' || type === 'unaccepted_terms') {
      const detail = errorText(msg.error);
      const fatal = type === 'auth_error' || type === 'quota_exceeded' || type === 'unaccepted_terms';
      this.handlers.onDown(detail ? `${type}: ${detail}` : type || 'unknown', fatal);
    }
  }
}

function errorText(error: unknown): string {
  if (typeof error === 'string') return error.trim().slice(0, 180);
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message.trim().slice(0, 180);
  return '';
}
