import OpenAI from 'openai';
import { config } from '../../config';
import { JURY_ROLES, claimOnlyUser, deliberationSystem, ROUND1_SYSTEM } from './prompts';
import { ROUND1_JSON_SCHEMA, ROUND2_JSON_SCHEMA, applyDeliberation, readRound1 } from './schemas';
import { JuryFailure, type Round1Analysis } from './types';

async function generate(system: string, user: string, schema: object, name: string, signal: AbortSignal): Promise<string> {
  if (!config.openaiApiKey) throw new JuryFailure('OPENAI_API_KEY is not set.');
  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const completion = await client.chat.completions.create({
    model: config.openaiModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name, strict: true, schema: schema as { [key: string]: unknown } },
    },
  }, { signal });
  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) throw new Error('ChatGPT returned no jury text.');
  return text;
}

export async function chatgptIndependent(claim: string, topic: string, signal: AbortSignal): Promise<Round1Analysis> {
  const text = await generate(ROUND1_SYSTEM.chatgpt, claimOnlyUser(claim, topic), ROUND1_JSON_SCHEMA, 'jury_round1', signal);
  return readRound1('chatgpt', JURY_ROLES.chatgpt, text);
}

export async function chatgptDeliberate(packet: string, own: Round1Analysis, signal: AbortSignal) {
  const text = await generate(deliberationSystem('chatgpt'), packet, ROUND2_JSON_SCHEMA, 'jury_round2', signal);
  return applyDeliberation(own, text);
}
