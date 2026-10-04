import { SPOKEN_PLAYBACK_RATE, type JuryModel } from '@teeto/shared';
import { config } from '../config';

/** 64 kbps MP3: small enough to send over the socket, and its length follows from its size. */
const OUTPUT_FORMAT = 'mp3_44100_64';
const BITS_PER_MS = 64;
const TIMEOUT_MS = 8_000;

export interface SpokenAudio {
  audio: Buffer;
  durationMs: number;
}

function voiceFor(model: JuryModel): string {
  return model === 'claude' ? config.elevenLabsVoiceClaude : config.elevenLabsVoiceGemini;
}

let warned = false;

/** Read one juror line aloud with that juror's voice. */
export function speakJurorLine(model: JuryModel, text: string): Promise<SpokenAudio | null> {
  return speak(voiceFor(model), text);
}

/** The debate host's voice: opens each round. */
export function speakHostLine(text: string): Promise<SpokenAudio | null> {
  return speak(config.elevenLabsVoiceHost, text);
}

/**
 * Returns null when TTS is off, the key is missing, or the request fails: callers carry on
 * as text only.
 */
async function speak(voiceId: string, text: string): Promise<SpokenAudio | null> {
  if (!config.elevenLabsTts || !config.elevenLabsApiKey || !text.trim()) return null;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': config.elevenLabsApiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: config.elevenLabsTtsModel, voice_settings: { speed: config.elevenLabsTtsSpeed } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 160);
      if (!warned) console.warn(`[tts] ElevenLabs ${res.status}: ${detail}`);
      warned = true;
      return null;
    }
    const audio = Buffer.from(await res.arrayBuffer());
    warned = false;
    // Length as heard in the room: clients play it SPOKEN_PLAYBACK_RATE times faster.
    return { audio, durationMs: Math.round((audio.length * 8) / BITS_PER_MS / SPOKEN_PLAYBACK_RATE) };
  } catch (err) {
    if (!warned) console.warn('[tts] ElevenLabs request failed:', err instanceof Error ? err.message : 'error');
    warned = true;
    return null;
  }
}
