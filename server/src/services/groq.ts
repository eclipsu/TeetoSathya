import OpenAI from 'openai';
import { config } from '../config';
import { parseModelJson } from './factChecking/schemas';

/** One JSON chat completion on Groq. The caller supplies a prompt that asks for JSON. */
export async function groqText(system: string, user: string, signal?: AbortSignal): Promise<string> {
  if (!config.groqApiKey) throw new Error('GROQ_API_KEY is not set.');
  const client = new OpenAI({ apiKey: config.groqApiKey, baseURL: 'https://api.groq.com/openai/v1' });
  const completion = await client.chat.completions.create({
    model: config.groqModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  }, { signal });
  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) throw new Error('Groq returned no text.');
  return text;
}

export async function groqJson(system: string, user: string, signal?: AbortSignal): Promise<unknown> {
  return parseModelJson(await groqText(system, user, signal));
}
