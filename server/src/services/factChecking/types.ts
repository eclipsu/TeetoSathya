import type { JuryBinary, JuryModel } from '@teeto/shared';

/** One model's independent review. Not shown to the other models until every review is in. */
export interface Round1Analysis {
  model: JuryModel;
  role: string;
  verdict: JuryBinary;
  /** False when the claim is about a different subject than the room topic. */
  onTopic: boolean;
  confidence: number;
  reasoning: string;
  /** Short line said to the room. The full reasoning still goes to the other juror. */
  spoken: string;
  /** Up to 3 named sources the juror relied on. */
  sources: string[];
  keyBasis: string[];
  limitations: string[];
}

/** Missing configuration. Not retried. */
export class JuryFailure extends Error {
  readonly permanent = true;
  constructor(message: string) {
    super(message);
    this.name = 'JuryFailure';
  }
}
