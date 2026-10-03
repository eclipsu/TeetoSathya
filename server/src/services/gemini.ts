import { config } from '../config';

export interface GeminiRequest {
  apiKey: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  temperature?: number;
}

/** One JSON generation against the configured Gemini model. Throws on HTTP or empty output. */
export async function geminiJson(req: GeminiRequest, signal?: AbortSignal): Promise<unknown> {
  const model = config.geminiModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': req.apiKey },
    signal,
    body: JSON.stringify({
      system_instruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.2,
        responseMimeType: 'application/json',
        responseSchema: req.schema,
      },
    }),
  });
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string };
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  } | null;
  if (!res.ok) throw new Error(body?.error?.message || `Gemini HTTP ${res.status}`);
  const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
  if (!text) throw new Error('Gemini returned no text.');
  return parseJson(text);
}

export function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  return JSON.parse(raw);
}
