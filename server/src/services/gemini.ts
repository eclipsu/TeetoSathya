import { config } from '../config';

export interface GeminiRequest {
  apiKey: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  temperature?: number;
  /** Skip the model's thinking step. Much faster (≈1 s vs 4–5 s); for simple extraction, not for judging. */
  fast?: boolean;
}

/** Configured model, then one backup. Each attempt is capped so a hung model cannot block Claude. */
export function geminiModelCandidates(): string[] {
  const fallbacks = [config.geminiModel, 'gemini-flash-latest'];
  return fallbacks.filter((model, index) => model && fallbacks.indexOf(model) === index);
}

export function geminiBusy(err: unknown): boolean {
  const message = err instanceof Error ? err.message : '';
  return /no longer available|high demand|overloaded|unavailable|timeout|timed out|503|429|500/i.test(message);
}

async function geminiJsonOnce(model: string, req: GeminiRequest, signal?: AbortSignal): Promise<unknown> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const attempt = signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': req.apiKey },
    signal: attempt,
    body: JSON.stringify({
      system_instruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.2,
        responseMimeType: 'application/json',
        responseSchema: req.schema,
        ...(req.fast ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
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

/** One JSON generation. If the chosen model is retired or overloaded, try the next candidate. */
export async function geminiJson(req: GeminiRequest, signal?: AbortSignal): Promise<unknown> {
  const models = geminiModelCandidates();
  let last: Error | null = null;
  for (const model of models) {
    try {
      return await geminiJsonOnce(model, req, signal);
    } catch (err) {
      last = err instanceof Error ? err : new Error('Gemini request failed.');
      if (signal?.aborted || !geminiBusy(last)) throw last;
      console.warn(`[gemini] ${model} unavailable, trying the next model`);
    }
  }
  throw last ?? new Error('Gemini request failed.');
}

export function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  return JSON.parse(raw);
}
