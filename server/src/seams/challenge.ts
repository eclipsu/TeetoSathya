import type { Buzz, Room } from '../domain/model';

/**
 * FUTURE SEAM: fact-check "challenge" pipeline. NOT IMPLEMENTED.
 *
 * Today a buzz only pauses the clocks and hands the floor to the other side; the host
 * dismisses it and the clock resumes. Later, a challenge module will plug in here:
 *
 *   buzz locked  ->  capture the challenged claim (e.g. from the live transcript)
 *                ->  ChallengeModule.evaluate({ claimText, challenger, speaker })
 *                ->  verdict decides: score change, and/or "caught speaker is replaced"
 *                    (that replacement already exists as rotateSpeaker in domain/game.ts)
 */

export interface ChallengeParty {
  participantId: string;
  username: string;
}

export interface ChallengeInput {
  roomId: string;
  claimText: string;
  challenger: ChallengeParty;
  speaker: ChallengeParty | null;
  buzzedAt: number;
}

export interface ChallengeVerdict {
  verdict: 'upheld' | 'rejected' | 'unclear';
  /** Points to add per team, e.g. [0, 1]. */
  scoreDelta?: [number, number];
  /** Replace the challenged speaker with their next teammate. */
  replaceSpeaker?: boolean;
  explanation?: string;
}

export interface ChallengeModule {
  evaluate(input: ChallengeInput): Promise<ChallengeVerdict>;
}

/**
 * Called after the host resolves (dismisses) a buzz. Placeholder: logs only.
 * `speaker` is the hot-seat speaker who was challenged (the side that held the floor at the buzz).
 */
export function onBuzzResolved(buzz: Buzz, room: Room, speakerSessionId: string | null): void {
  const challenger = room.participants.get(buzz.sessionId);
  const speaker = speakerSessionId ? room.participants.get(speakerSessionId) : undefined;
  console.log(
    `[challenge] (seam, not implemented) ${buzz.username} challenged ${speaker?.username ?? 'unknown'} in ${room.id}` +
      ` at ${new Date(buzz.at).toISOString()} (challenger ${challenger ? 'still present' : 'left'})`,
  );
}
