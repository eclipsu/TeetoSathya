import { config } from '../config';
import { claudeJson } from './claude';
import { geminiBusy, geminiJson } from './gemini';

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

const CLAUDE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          originalText: { type: 'string' },
        },
        required: ['text', 'originalText'],
      },
    },
  },
  required: ['claims'],
};

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

/** TEMP dummy speech for the test button. Delete with claims:demo. */
export const DUMMY_SPEECH = 'The capital of Australia is Sydney. The United States has 50 states. Australia has more than 100 million people. Every planet in the Solar System has at least one moon.';

function briefError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'request failed';
  return message.replace(/request_id":"[^"]+"/g, '').slice(0, 180);
}

/** TEMP: ask Gemini and Claude separately so the test button can show which one answered. */
export async function probeClaimExtraction(transcript: string): Promise<{
  gemini: { ok: boolean; claims: string[]; error: string | null };
  claude: { ok: boolean; claims: string[]; error: string | null };
}> {
  const user = `Finalized speech from one speaker:\n"""${transcript.slice(0, 6000)}"""`;
  const signal = AbortSignal.timeout(12_000);
  const [gemini, claude] = await Promise.all([
    (async () => {
      const apiKey = config.geminiApiKey || config.geminiFactsKey;
      if (!apiKey) return { ok: false as const, claims: [] as string[], error: 'GEMINI_API_KEY is not set.' };
      try {
        const raw = await geminiJson({ apiKey, system: CLAIM_EXTRACTION_PROMPT, user, schema: SCHEMA, temperature: 0.2 }, signal);
        return { ok: true as const, claims: parseDraftClaims(raw).map((d) => d.text), error: null };
      } catch (err) {
        return { ok: false as const, claims: [] as string[], error: briefError(err) };
      }
    })(),
    (async () => {
      if (!config.anthropicApiKey) return { ok: false as const, claims: [] as string[], error: 'CLAUDE_API_KEY is not set.' };
      try {
        const raw = await claudeJson(CLAIM_EXTRACTION_PROMPT, user, CLAUDE_SCHEMA, signal);
        return { ok: true as const, claims: parseDraftClaims(raw).map((d) => d.text), error: null };
      } catch (err) {
        return { ok: false as const, claims: [] as string[], error: briefError(err) };
      }
    })(),
  ]);
  return { gemini, claude };
}

/** Extract challengeable claims. Returns [] when the key is missing. Throws on API failure. */
let warnedMissingKey = false;

export async function extractClaims(transcript: string, signal?: AbortSignal): Promise<DraftClaim[]> {
  const text = transcript.trim();
  if (!text) return [];
  const user = `Finalized speech from one speaker:\n"""${text.slice(0, 6000)}"""`;
  const apiKey = config.geminiApiKey || config.geminiFactsKey;
  if (!apiKey && !config.anthropicApiKey) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn('[claims] GEMINI_API_KEY is not set; claim extraction is off.');
    }
    return [];
  }
  const attempts: Promise<{ source: string; drafts: DraftClaim[] }>[] = [];
  if (apiKey) {
    attempts.push(geminiJson({
      apiKey,
      system: CLAIM_EXTRACTION_PROMPT,
      user,
      schema: SCHEMA,
      temperature: 0.2,
    }, signal).then((raw) => ({ source: 'gemini', drafts: parseDraftClaims(raw) })));
  }
  if (config.anthropicApiKey) {
    attempts.push(claudeJson(CLAIM_EXTRACTION_PROMPT, user, CLAUDE_SCHEMA, signal).then((raw) => ({ source: 'claude', drafts: parseDraftClaims(raw) })));
  }
  return firstClaims(attempts);
}

/** Use the first model that returns claims. Gemini being down must not delay Claude. */
function firstClaims(attempts: Promise<{ source: string; drafts: DraftClaim[] }>[]): Promise<DraftClaim[]> {
  return new Promise((resolve, reject) => {
    let pending = attempts.length;
    let sawSuccess = false;
    let lastErr: unknown;
    const finish = () => {
      if (--pending > 0) return;
      if (sawSuccess) resolve([]);
      else reject(lastErr instanceof Error ? lastErr : new Error('extraction failed'));
    };
    for (const attempt of attempts) {
      attempt.then((result) => {
        if (result.drafts.length) {
          if (result.source === 'claude') console.warn('[claims] using Claude');
          resolve(result.drafts);
          return;
        }
        sawSuccess = true;
        finish();
      }, (err: unknown) => {
        if (!geminiBusy(err)) lastErr = err;
        else lastErr ??= err;
        finish();
      });
    }
  });
}
