import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { parseModelJson } from './factChecking/schemas';

/** One JSON message on Claude. Used when Gemini is unavailable and for the Claude juror path. */
export async function claudeJson(system: string, user: string, schema: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  if (!config.anthropicApiKey) throw new Error('CLAUDE_API_KEY is not set.');
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const message = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema } },
  }, { signal });
  const block = message.content.find((part) => part.type === 'text');
  const text = block && block.type === 'text' ? block.text.trim() : '';
  if (!text) throw new Error('Claude returned no text.');
  return parseModelJson(text);
}
