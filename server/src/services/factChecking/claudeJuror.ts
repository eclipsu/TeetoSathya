import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config';
import { JURY_ROLES, claimOnlyUser, deliberationSystem, ROUND1_SYSTEM } from './prompts';
import { ROUND1_JSON_SCHEMA, ROUND2_JSON_SCHEMA, applyDeliberation, readRound1 } from './schemas';
import { JuryFailure, type Round1Analysis } from './types';

async function generate(system: string, user: string, schema: object, signal: AbortSignal): Promise<string> {
  if (!config.anthropicApiKey) throw new JuryFailure('ANTHROPIC_API_KEY is not set.');
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const message = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 1024,
    temperature: 0.2,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema: schema as { [key: string]: unknown } } },
  }, { signal });
  const block = message.content.find((part) => part.type === 'text');
  const text = block && block.type === 'text' ? block.text.trim() : '';
  if (!text) throw new Error('Claude returned no jury text.');
  return text;
}

export async function claudeIndependent(claim: string, signal: AbortSignal): Promise<Round1Analysis> {
  const text = await generate(ROUND1_SYSTEM.claude, claimOnlyUser(claim), ROUND1_JSON_SCHEMA, signal);
  return readRound1('claude', JURY_ROLES.claude, text);
}

export async function claudeDeliberate(packet: string, own: Round1Analysis, signal: AbortSignal) {
  const text = await generate(deliberationSystem('claude'), packet, ROUND2_JSON_SCHEMA, signal);
  return applyDeliberation(own, text);
}
