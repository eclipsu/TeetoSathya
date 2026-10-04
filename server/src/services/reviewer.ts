import type { PlayerReview, RoundWinner } from '@teeto/shared';
import { config } from '../config';
import { claudeJson } from './claude';
import { geminiJson } from './gemini';
import { capWords } from './factChecking/schemas';

const WRITE_TIMEOUT_MS = 7_000;
const LINE_WORDS = 22;

const SYSTEM = `You are the two AI fact-check jurors of a live debate game, wrapping up after the final round.
Write a very short spoken review the room will hear, read aloud by alternating voices.
One line per player, in the order given, then one final line announcing the result.
Each line is one sentence of at most 18 words: how accurate they were, what they leaned on, and their best moment or slip.
Use the numbers given; never invent facts, scores, or claims. Light and fair, no emoji, no quotation marks around names.
The final line must state the result exactly as given.`;

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: { lines: { type: 'ARRAY', items: { type: 'STRING' } } },
  required: ['lines'],
};
const CLAUDE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { lines: { type: 'array', items: { type: 'string' } } },
  required: ['lines'],
};

export interface ReviewContext {
  topic: string;
  sides: [string, string];
  scores: [number, number];
  winner: RoundWinner | null;
}

export function resultLine(ctx: ReviewContext): string {
  const [a, b] = ctx.scores;
  if (ctx.winner === 0 || ctx.winner === 1) {
    const w = ctx.winner;
    return `${ctx.sides[w]} wins, ${ctx.scores[w]} to ${ctx.scores[w === 0 ? 1 : 0]}.`;
  }
  if (ctx.winner === 'draw') return `It's a draw at ${a} to ${b}.`;
  return `It's tied at ${a} to ${b}, so the host picks the winner.`;
}

function playerFacts(p: PlayerReview, sides: [string, string]): string {
  const acc = p.checked ? `${p.stood} of ${p.checked} challenged claims held up` : 'none of their claims were challenged';
  const ch = p.challenges ? `called ${p.challenges} fact check${p.challenges > 1 ? 's' : ''}, ${p.landed} landed (${p.points >= 0 ? '+' : ''}${p.points} points)` : 'called no fact checks';
  const lean = p.leanedOn ? `leaned on: ${p.leanedOn}` : 'made no checkable claims';
  return `- ${p.name} (${sides[p.team]}): ${p.claims} claims; ${acc}; ${ch}; knocked out ${p.outs} time${p.outs === 1 ? '' : 's'}; ${lean}`;
}

/** Plain fallback when the models are unavailable: still one line per player and the result. */
function template(players: PlayerReview[], ctx: ReviewContext): string[] {
  return [
    ...players.map((p) => {
      const acc = p.checked ? `${p.stood} of ${p.checked} challenged claims held up` : 'no claims challenged';
      return `${p.name}: ${acc}, ${p.landed} of ${p.challenges} challenges landed.`;
    }),
    resultLine(ctx),
  ];
}

/**
 * The review script: one short line per player, then the result. The models only write the words;
 * the result line is checked against the real score and replaced if it doesn't match.
 */
export async function writeReview(players: PlayerReview[], ctx: ReviewContext): Promise<string[]> {
  const result = resultLine(ctx);
  const user = [
    `Motion: """${ctx.topic}"""`,
    `Final score: ${ctx.sides[0]} ${ctx.scores[0]}, ${ctx.sides[1]} ${ctx.scores[1]}.`,
    'Players:',
    ...players.map((p) => playerFacts(p, ctx.sides)),
    `Result line to state: ${result}`,
  ].join('\n');
  let lines: string[] | null = null;
  const signal = AbortSignal.timeout(WRITE_TIMEOUT_MS);
  const apiKey = config.geminiApiKey || config.geminiFactsKey;
  try {
    if (!apiKey) throw new Error('no Gemini key');
    const raw = await geminiJson({ apiKey, system: SYSTEM, user, schema: GEMINI_SCHEMA, temperature: 0.6, fast: true }, signal) as { lines?: unknown };
    lines = Array.isArray(raw.lines) ? raw.lines.filter((l): l is string => typeof l === 'string' && !!l.trim()) : null;
  } catch {
    try {
      const raw = await claudeJson(SYSTEM, user, CLAUDE_SCHEMA, signal) as { lines?: unknown };
      lines = Array.isArray(raw.lines) ? raw.lines.filter((l): l is string => typeof l === 'string' && !!l.trim()) : null;
    } catch (err) {
      console.warn('[review] using the plain review:', err instanceof Error ? err.message.slice(0, 120) : 'error');
    }
  }
  if (!lines || lines.length < players.length) return template(players, ctx);
  const body = lines.slice(0, players.length).map((l) => capWords(l, LINE_WORDS));
  // The last line announces the result: keep the model's wording only if it states the real result.
  const last = lines[players.length];
  const winnerName = ctx.winner === 0 || ctx.winner === 1 ? ctx.sides[ctx.winner] : null;
  const ok = last && (winnerName ? last.includes(winnerName) : /tie|draw/i.test(last)) && last.includes(String(ctx.scores[0])) && last.includes(String(ctx.scores[1]));
  return [...body, ok ? capWords(last, LINE_WORDS) : result];
}
