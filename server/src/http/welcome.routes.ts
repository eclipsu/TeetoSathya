import { Router } from 'express';
import { normalizeUsername, validateUsername } from '@teeto/shared';
import { config } from '../config';

/** Premade ElevenLabs voice (Rachel). Override with ELEVENLABS_VOICE_ID. */
const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM';

export const welcomeRouter = Router();

welcomeRouter.post('/welcome', async (req, res) => {
  const error = validateUsername(req.body?.name);
  if (error) {
    res.status(400).json({ error: { code: 'bad_name', message: error } });
    return;
  }
  if (!config.elevenLabsApiKey) {
    res.status(503).json({ error: { code: 'speech_off', message: 'Welcome speech is not configured.' } });
    return;
  }

  const name = normalizeUsername(String(req.body.name));
  const text = `Welcome ${name}.`;
  const voice = config.elevenLabsVoiceId || DEFAULT_VOICE;

  try {
    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': config.elevenLabsApiKey,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
    });
    if (!upstream.ok) {
      console.error(`[welcome] speech failed (${upstream.status})`);
      res.status(502).json({ error: { code: 'speech_failed', message: 'Welcome speech failed.' } });
      return;
    }
    const audio = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('cache-control', 'no-store');
    res.send(audio);
  } catch {
    console.error('[welcome] speech failed');
    res.status(502).json({ error: { code: 'speech_failed', message: 'Welcome speech failed.' } });
  }
});
