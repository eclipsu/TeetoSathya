import type { FactVerdict } from '@teeto/shared';
import { coerceVerdict } from '../domain/factcheck';
import { config } from '../config';
import { geminiJson } from './gemini';

export const FACT_CHECK_PROMPT = `You are the neutral factual referee for a competitive live debate game.

A participant has challenged ONE factual statement made by an opposing speaker.

Evaluate the EXACT claim provided.

You are not participating in the debate and must not favor either team.

Return one verdict:

SUPPORTED — the claim is factually correct according to well-established knowledge.

CONTRADICTED — the claim is factually incorrect according to well-established knowledge.

INCONCLUSIVE — the claim cannot be determined reliably, is ambiguous, subjective, missing necessary context, highly time-sensitive, or you are not sufficiently confident.

When uncertain, return INCONCLUSIVE.

Never guess just because the game expects a winner.

Evaluate the claim exactly as stated. Do not silently rewrite it.

Pay close attention to qualifiers such as all, none, always, never, most, only, first, largest, smallest, more than, less than, currently, every, and exactly.

Do not change an incorrect claim into a nearby correct claim.

Treat normal conversational approximations reasonably.

If a statement depends on an undefined metric or ambiguous wording, return INCONCLUSIVE.

Be conservative with time-sensitive facts because you are not using live web search.

Only return SUPPORTED or CONTRADICTED when confidence is at least 0.80. Otherwise return INCONCLUSIVE.

The explanation must be concise, ideally 1-3 sentences, and state the key factual reason for the verdict.

Do not mention being an AI.

Do not fabricate citations, URLs, quotations, or evidence.

Return structured JSON only.`;

export interface CheckedClaim {
  claim: string;
  verdict: FactVerdict;
  confidence: number;
  explanation: string;
}

const FALLBACK: Record<FactVerdict, string> = {
  SUPPORTED: 'The claim matches well-established facts.',
  CONTRADICTED: 'The claim does not match well-established facts.',
  INCONCLUSIVE: 'The claim could not be decided reliably.',
  CORRECT: 'The claim matches well-established facts.',
  INCORRECT: 'The claim does not match well-established facts.',
};

export function parseCheckedClaim(claim: string, raw: unknown): CheckedClaim | null {
  if (!raw || typeof raw !== 'object') return null;
  const verdictRaw = typeof (raw as { verdict?: unknown }).verdict === 'string' ? (raw as { verdict: string }).verdict : '';
  const confidenceRaw = (raw as { confidence?: unknown }).confidence;
  const confidence = typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : 0;
  const verdict = coerceVerdict(verdictRaw, confidence);
  if (!verdict) return null;
  const explanationRaw = typeof (raw as { explanation?: unknown }).explanation === 'string'
    ? (raw as { explanation: string }).explanation.trim()
    : '';
  return {
    claim,
    verdict,
    confidence,
    explanation: (explanationRaw || FALLBACK[verdict]).slice(0, 500),
  };
}

/** Judge one claim. Throws if the key is missing or the API fails — the caller maps that to "unavailable". */
export async function checkClaim(claim: string, signal?: AbortSignal): Promise<CheckedClaim> {
  const apiKey = config.geminiFactsKey || config.geminiApiKey;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');
  const raw = await geminiJson({
    apiKey,
    system: FACT_CHECK_PROMPT,
    user: JSON.stringify({ claim }),
    schema: {
      type: 'OBJECT',
      properties: {
        verdict: { type: 'STRING', enum: ['SUPPORTED', 'CONTRADICTED', 'INCONCLUSIVE'] },
        confidence: { type: 'NUMBER' },
        explanation: { type: 'STRING' },
      },
      required: ['verdict', 'confidence', 'explanation'],
    },
    temperature: 0.1,
  }, signal);
  const parsed = parseCheckedClaim(claim, raw);
  if (!parsed) throw new Error('Fact checker returned an unreadable verdict.');
  return parsed;
}
