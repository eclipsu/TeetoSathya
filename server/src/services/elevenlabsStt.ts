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
    url.searchParams.set('vad_silence_threshold_secs', '0.8');
    url.searchParams.set('language_code', 'en');
    const ws = new WebSocket(url, { headers: { 'xi-api-key': config.elevenLabsApiKey } });
    this.ws = ws;
    ws.on('open', () => this.handlers.onOpen());
    ws.on('message', (data) => this.onMessage(data.toString()));
    ws.on('error', (err) => this.handlers.onDown(err.message, false));
    ws.on('close', () => {
      if (!this.closed) this.handlers.onDown('ElevenLabs connection closed.', false);
      this.commitWait?.();
      this.commitWait = null;
    });
  }

  sendPcm(pcm: Buffer): void {
    if (!this.open) return;
    this.sentAudio = true;
    this.ws!.send(JSON.stringify({
      message_type: 'input_audio_chunk',
      audio_base_64: pcm.toString('base64'),
      commit: false,
      sample_rate: 16000,
    }));
  }

  /** Ask ElevenLabs to finalize whatever is still buffered. Resolves on the next commit or after `ms`. */
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
      try {
        this.ws!.send(JSON.stringify({ message_type: 'commit' }));
      } catch {
        clearTimeout(timer);
        this.commitWait = null;
        resolve();
      }
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
    let msg: { message_type?: string; text?: string };
    try { msg = JSON.parse(raw) as { message_type?: string; text?: string }; } catch { return; }
    const type = msg.message_type ?? '';
    if (type === 'partial_transcript') {
      if (msg.text) this.handlers.onPartial(msg.text);
      return;
    }
    if (type === 'committed_transcript' || type === 'committed_transcript_with_timestamps') {
      const text = (msg.text ?? '').trim();
      if (text) this.handlers.onCommitted(text);
      this.commitWait?.();
      return;
    }
    if (type === 'session_started') return;
    if (type.endsWith('_error') || type === 'error') {
      const fatal = type === 'auth_error' || type === 'quota_exceeded';
      this.handlers.onDown(type, fatal);
    }
  }
}
