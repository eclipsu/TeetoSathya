import { config } from '../config';
import { geminiJson } from './gemini';

export const CLAIM_EXTRACTION_PROMPT = `You are a factual-claim extraction engine for a live competitive debate game.

You receive finalized speech from ONE known speaker.

Your job is NOT to determine whether statements are true or false.

Extract only objectively challengeable factual claims that could reasonably be verified or contradicted.

Extract claims involving things such as numbers, dates, historical events, science, economics, geography, laws, documented events, measurable comparisons, organizations, statistics, and other externally verifiable assertions.

Do not extract personal opinions, preferences, recommendations, rhetorical questions, insults, jokes, greetings, filler, predictions, or purely emotional statements.

A claim does NOT need to be correct to be extracted.

Do not correct false claims.

Preserve the speaker's actual meaning.

Do not introduce facts, numbers, entities, dates, or specificity the speaker did not provide.

Break compound factual statements into separate atomic claims when appropriate.

Keep each claim short and readable because an opposing participant may need to select it within seconds during a live game.

Preserve the relevant original wording as originalText.

Return structured JSON only.

If there are no objectively fact-checkable claims, return an empty claims array.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    claims: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          originalText: { type: 'STRING' },
        },
        required: ['text', 'originalText'],
      },
    },
  },
  required: ['claims'],
};

export interface DraftClaim {
  text: string;
  originalText: string;
}

export function parseDraftClaims(raw: unknown): DraftClaim[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { claims?: unknown }).claims)
    ? (raw as { claims: unknown[] }).claims
    : [];
  const out: DraftClaim[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const text = typeof (item as { text?: unknown }).text === 'string' ? (item as { text: string }).text.trim() : '';
    if (!text) continue;
    const original = typeof (item as { originalText?: unknown }).originalText === 'string'
      ? (item as { originalText: string }).originalText.trim()
      : '';
    out.push({ text, originalText: original || text });
  }
  return out;
}

/** Extract challengeable claims. Returns [] when the key is missing. Throws on API failure. */
let warnedMissingKey = false;

export async function extractClaims(transcript: string, signal?: AbortSignal): Promise<DraftClaim[]> {
  const text = transcript.trim();
  if (!text) return [];
  if (!config.geminiApiKey) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn('[claims] GEMINI_API_KEY is not set; claim extraction is off.');
    }
    return [];
  }
  const raw = await geminiJson({
    apiKey: config.geminiApiKey,
    system: CLAIM_EXTRACTION_PROMPT,
    user: `Finalized speech from one speaker:\n"""${text.slice(0, 6000)}"""`,
    schema: SCHEMA,
    temperature: 0.2,
  }, signal);
  return parseDraftClaims(raw);
}
