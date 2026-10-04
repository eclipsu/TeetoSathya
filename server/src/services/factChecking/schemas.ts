import { z } from 'zod';
import type { JuryBinary, JuryModel, JuryVote } from '@teeto/shared';
import type { Round1Analysis } from './types';

const binary = z.enum(['CORRECT', 'INCORRECT']);

/** Accept 0–1, or a 1–100 percent that some models emit, then require a unit interval. */
const confidence = z.preprocess((value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  if (value > 1 && value <= 100) return value / 100;
  return value;
}, z.number().min(0).max(1));

const shortText = z.string().trim().min(1).max(1200);
const notes = z.array(z.string().trim().min(1).max(240)).max(6);
/** Optional so a model that skips it still parses; spokenLine() falls back to the reasoning. */
const spoken = z.string().trim().max(400).optional();
/** Named sources (no links). Optional so a model that skips them still parses. */
// Never reject a vote over its sources: long or extra entries are trimmed in cleanSources().
const sources = z.array(z.string()).optional();
const SOURCES_HINT = 'Up to 2 well-known sources you rely on, written as "Organization, dataset or report, year". Only name sources you are confident exist. No URLs. Never invent titles, numbers or quotes. Use "General knowledge" if you have nothing specific.';

/** Clean the model's source list: drop links and duplicates, at most 3. */
export function cleanSources(list: string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of list ?? []) {
    let s = raw.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '');
    if (s.length > 100) s = `${s.slice(0, 99).replace(/[\s,;/]+\S*$/, '')}…`;
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out.slice(0, 3);
}

const SPOKEN_WORDS = 14;
/** Detailed mode (host's choice) reads the juror's full reasoning, up to this many words. */
export const DETAILED_WORDS = 45;
const SPOKEN_HINT = `One short sentence said out loud to the debate room, at most ${SPOKEN_WORDS - 2} words. Verdict first, then the one fact that decides it. No lists, no hedging, no sources.`;

export function capWords(text: string, max: number): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  if (words.length <= max) return words.join(' ');
  return `${words.slice(0, max).join(' ').replace(/[,;:]$/, '')}…`;
}

/** The line shown and spoken in the room: the model's `spoken`, else the reasoning's first sentence, capped. */
export function spokenLine(text: string | undefined, fallback: string): string {
  const raw = text?.trim() || fallback.trim().split(/(?<=[.!?])\s+/)[0] || fallback;
  return capWords(raw, SPOKEN_WORDS);
}

/** Round 1. The server stamps model and role; the model cannot choose its identity. */
export const round1Schema = z.object({
  verdict: binary,
  onTopic: z.boolean(),
  confidence,
  reasoning: shortText,
  spoken,
  sources,
  keyBasis: notes,
  limitations: notes,
}).strict();

/** Round 2. initialVerdict and changedVote are overwritten from the server's Round 1 record. */
export const round2Schema = z.object({
  initialVerdict: binary,
  initialConfidence: confidence,
  finalVerdict: binary,
  onTopic: z.boolean(),
  finalConfidence: confidence,
  changedVote: z.boolean(),
  responseToOthers: shortText,
  finalReasoning: shortText,
  spoken,
  sources,
}).strict();

export type Round1Fields = z.infer<typeof round1Schema>;
export type Round2Fields = z.infer<typeof round2Schema>;

export const ROUND1_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['CORRECT', 'INCORRECT'] },
    onTopic: { type: 'boolean' },
    confidence: { type: 'number' },
    reasoning: { type: 'string' },
    spoken: { type: 'string', description: SPOKEN_HINT },
    sources: { type: 'array', items: { type: 'string' }, description: SOURCES_HINT },
    keyBasis: { type: 'array', items: { type: 'string' } },
    limitations: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'onTopic', 'confidence', 'reasoning', 'spoken', 'sources', 'keyBasis', 'limitations'],
} as const;

export const ROUND2_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    initialVerdict: { type: 'string', enum: ['CORRECT', 'INCORRECT'] },
    initialConfidence: { type: 'number' },
    finalVerdict: { type: 'string', enum: ['CORRECT', 'INCORRECT'] },
    onTopic: { type: 'boolean' },
    finalConfidence: { type: 'number' },
    changedVote: { type: 'boolean' },
    responseToOthers: { type: 'string' },
    finalReasoning: { type: 'string' },
    spoken: { type: 'string', description: `${SPOKEN_HINT} Answer the other juror directly.` },
    sources: { type: 'array', items: { type: 'string' }, description: SOURCES_HINT },
  },
  required: ['initialVerdict', 'initialConfidence', 'finalVerdict', 'onTopic', 'finalConfidence', 'changedVote', 'responseToOthers', 'finalReasoning', 'spoken', 'sources'],
} as const;

export function parseModelJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced?.[1] ?? text).trim());
}

export function readRound1(model: JuryModel, role: string, text: string): Round1Analysis {
  const parsed = round1Schema.parse(parseModelJson(text));
  return {
    model,
    role,
    verdict: parsed.onTopic ? parsed.verdict : 'INCORRECT',
    onTopic: parsed.onTopic,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    spoken: spokenLine(parsed.spoken, parsed.reasoning),
    sources: cleanSources(parsed.sources),
    keyBasis: parsed.keyBasis,
    limitations: parsed.limitations,
  };
}

/** Trust Round 1 for the initial vote. The model's changedVote flag is not used. */
export function applyDeliberation(own: Round1Analysis, text: string): JuryVote {
  const parsed = round2Schema.parse(parseModelJson(text));
  const finalVerdict: JuryBinary = parsed.onTopic ? parsed.finalVerdict : 'INCORRECT';
  return {
    model: own.model,
    role: own.role,
    onTopic: parsed.onTopic,
    initialVerdict: own.verdict,
    initialConfidence: own.confidence,
    finalVerdict,
    finalConfidence: parsed.finalConfidence,
    changedVote: finalVerdict !== own.verdict,
    reasoning: parsed.finalReasoning,
    limitations: own.limitations,
    responseToOthers: parsed.responseToOthers,
    spoken: spokenLine(parsed.spoken, parsed.responseToOthers || parsed.finalReasoning),
    sources: cleanSources(parsed.sources).length ? cleanSources(parsed.sources) : own.sources,
  };
}
