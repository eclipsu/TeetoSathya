import { GoogleGenAI } from '@google/genai';
import { config } from '../../config';
import { JURY_ROLES, claimOnlyUser, deliberationSystem, ROUND1_SYSTEM } from './prompts';
import { ROUND1_JSON_SCHEMA, ROUND2_JSON_SCHEMA, applyDeliberation, readRound1 } from './schemas';
import { JuryFailure, type Round1Analysis } from './types';

/** Same structured Gemini call as the evidence juror, on the second key, with the skeptic prompt. */
async function generate(system: string, user: string, schema: unknown, signal: AbortSignal): Promise<string> {
  if (!config.geminiSecondKey) throw new JuryFailure('GEMINI_2ND_MODEL_KEY is not set.');
  const ai = new GoogleGenAI({ apiKey: config.geminiSecondKey });
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
  if (!text) throw new Error('Gemini skeptic returned no jury text.');
  return text;
}

export async function geminiSkepticIndependent(claim: string, signal: AbortSignal): Promise<Round1Analysis> {
  const text = await generate(ROUND1_SYSTEM.gemini_skeptic, claimOnlyUser(claim), ROUND1_JSON_SCHEMA, signal);
  return readRound1('gemini_skeptic', JURY_ROLES.gemini_skeptic, text);
}

export async function geminiSkepticDeliberate(packet: string, own: Round1Analysis, signal: AbortSignal) {
  const text = await generate(deliberationSystem('gemini_skeptic'), packet, ROUND2_JSON_SCHEMA, signal);
  return applyDeliberation(own, text);
}
