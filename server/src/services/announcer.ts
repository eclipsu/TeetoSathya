import { claudeJson } from './claude';
import { speakHostLine, type SpokenAudio } from './elevenlabsTts';
import { capWords } from './factChecking/schemas';

const WRITE_TIMEOUT_MS = 5_000;
const MAX_WORDS = 22;

const SYSTEM = `You are the host of a live, fast-paced debate show.
Write the opening announcement for this round: the motion, the two sides, and who opens. Straight to the point.
One or two very short spoken sentences, at most ${MAX_WORDS - 4} words in total. No greeting, no welcome, no hype.
Neutral: never hint which side is right. Do not describe rules, formats, timing or scoring. No emoji, no stage directions, no quotation marks.
Use the side names and the speaker name exactly as given. Refer to the sides only by their names, never as Side A or Side B.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { line: { type: 'string' } },
  required: ['line'],
} as const;

export interface RoundIntro {
  text: string;
  voice: SpokenAudio | null;
}

function fallback(topic: string, sides: [string, string], opener: string | null, round: number, totalRounds: number, openingSide: 0 | 1): string {
  const head = totalRounds > 1 ? `Round ${round}. ` : '';
  const open = opener ? ` ${opener} opens for ${sides[openingSide]}.` : '';
  return `${head}${topic} ${sides[0]} versus ${sides[1]}.${open}`;
}


/**
 * The host's opening line for a round, written by Claude from the room's topic and sides and read
 * with the host voice. Falls back to a fixed line, and to text only when TTS is unavailable.
 */
export async function announceRound(topic: string, sides: [string, string], opener: string | null, round = 1, totalRounds = 1, openingSide: 0 | 1 = 0): Promise<RoundIntro> {
  let text = fallback(topic, sides, opener, round, totalRounds, openingSide);
  try {
    const roundLine = totalRounds > 1 ? `Round ${round} of ${totalRounds}. Mention the round number.` : 'Single round.';
    const user = `Motion: """${topic}"""\nSide A: """${sides[0]}"""\nSide B: """${sides[1]}"""\n${roundLine}\nOpening speaker (for ${openingSide === 0 ? 'Side A' : 'Side B'}): ${opener ? `"""${opener}"""` : 'not set'}`;
    const out = await claudeJson(SYSTEM, user, SCHEMA as unknown as Record<string, unknown>, AbortSignal.timeout(WRITE_TIMEOUT_MS)) as { line?: unknown };
    if (typeof out.line === 'string' && out.line.trim()) text = capWords(out.line, MAX_WORDS);
  } catch (err) {
    console.warn('[announcer] using the fixed intro:', err instanceof Error ? err.message.slice(0, 120) : 'error');
  }
  return { text, voice: await speakHostLine(text) };
}
