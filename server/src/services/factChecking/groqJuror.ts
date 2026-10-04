import { JURY_ROLES, claimOnlyUser, deliberationSystem, ROUND1_SYSTEM } from './prompts';
import { applyDeliberation, readRound1 } from './schemas';
import { groqText } from '../groq';
import { JuryFailure, type Round1Analysis } from './types';

async function generate(system: string, user: string, signal: AbortSignal): Promise<string> {
  try {
    return await groqText(system, user, signal);
  } catch (err) {
    if (err instanceof Error && err.message === 'GROQ_API_KEY is not set.') throw new JuryFailure(err.message);
    throw err;
  }
}

export async function groqIndependent(claim: string, signal: AbortSignal): Promise<Round1Analysis> {
  const text = await generate(ROUND1_SYSTEM.groq, claimOnlyUser(claim), signal);
  return readRound1('groq', JURY_ROLES.groq, text);
}

export async function groqDeliberate(packet: string, own: Round1Analysis, signal: AbortSignal) {
  const text = await generate(deliberationSystem('groq'), packet, signal);
  return applyDeliberation(own, text);
}
