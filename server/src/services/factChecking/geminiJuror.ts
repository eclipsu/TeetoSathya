import { GoogleGenAI } from '@google/genai';
import { config } from '../../config';
import { JURY_ROLES, claimOnlyUser, deliberationSystem, ROUND1_SYSTEM } from './prompts';
import { ROUND1_JSON_SCHEMA, ROUND2_JSON_SCHEMA, readRound1, applyDeliberation } from './schemas';
import { JuryFailure, type Round1Analysis } from './types';

async function generate(system: string, user: string, schema: unknown, signal: AbortSignal): Promise<string> {
  if (!config.geminiFactsKey) throw new JuryFailure('GEMINI_FACTS_KEY is not set.');
  const ai = new GoogleGenAI({ apiKey: config.geminiFactsKey });
  const response = await ai.models.generateContent({
    model: config.geminiModel,
    contents: user,
    config: {
      systemInstruction: system,
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
      abortSignal: signal,
    },
  });
  const text = response.text?.trim();
  if (!text) throw new Error('Gemini returned no jury text.');
  return text;
}

export async function geminiIndependent(claim: string, signal: AbortSignal): Promise<Round1Analysis> {
  const text = await generate(ROUND1_SYSTEM.gemini, claimOnlyUser(claim), ROUND1_JSON_SCHEMA, signal);
  return readRound1('gemini', JURY_ROLES.gemini, text);
}

export async function geminiDeliberate(packet: string, own: Round1Analysis, signal: AbortSignal) {
  const text = await generate(deliberationSystem('gemini'), packet, ROUND2_JSON_SCHEMA, signal);
  return applyDeliberation(own, text);
}
