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
