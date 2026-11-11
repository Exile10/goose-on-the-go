/**
 * The wake test's arithmetic: what the phone's wake word would have done over a recording, and the
 * "hey goose" line it suggests. The native side (`testWake` in plugins/pond-wake/PondWake.kt) runs
 * the service's own pipeline and lists each candidate; this file counts them once the Pond has
 * answered the ones the phone would have asked it about.
 */

import type { PhoneVoices, WakeTestCandidate } from '@/services/phone-wake';

/** How many times the first part of the test asks for the phrase. */
export const PHRASE_TIMES = 10;

/** A candidate's end: it woke the phone, or it did not. */
export type WakeOutcome = 'woke' | 'quiet';

/** A candidate once the Pond answered (`heard`), or could not (`null`) for one it was asked about. */
export interface ResolvedCandidate extends WakeTestCandidate {
  /** For "ask_pond": whether the Pond heard the phrase; null when it could not be asked. */
  pond: boolean | null;
}

/**
 * Ask the Pond about each candidate the phone would have asked it about, one at a time as the
 * service does; `ask` answers whether the Pond heard the phrase, or null when it could not be asked.
 */
export async function resolveCandidates(
  candidates: WakeTestCandidate[],
  ask: (segment: string) => Promise<boolean | null>,
): Promise<ResolvedCandidate[]> {
  const out: ResolvedCandidate[] = [];
  for (const c of candidates) {
    out.push({ ...c, pond: c.decision === 'ask_pond' && c.segment ? await ask(c.segment) : null });
  }
  return out;
}

export function outcome(c: ResolvedCandidate): WakeOutcome {
  if (c.decision === 'wake') return 'woke';
  if (c.decision === 'ask_pond' && c.pond === true) return 'woke';
  return 'quiet';
}

export interface PhraseScore {
  /** Times the phrase woke the phone, at most `PHRASE_TIMES`. */
  caught: number;
  said: number;
  /** Candidates the service would not have heard at its line, though the CNN came close. */
  below: number;
  /** Candidates turned away for the voice. */
  voiceRefused: number;
  /** Candidates the Pond did not hear the phrase in, or could not be asked about. */
  pondRefused: number;
}

export function scorePhrase(candidates: ResolvedCandidate[], said = PHRASE_TIMES): PhraseScore {
  const woke = candidates.filter((c) => outcome(c) === 'woke').length;
  return {
    caught: Math.min(woke, said),
    said,
    below: candidates.filter((c) => c.decision === 'below').length,
    voiceRefused: candidates.filter((c) => c.decision === 'ignore').length,
    pondRefused: candidates.filter((c) => c.decision === 'ask_pond' && c.pond !== true).length,
  };
}

/** False wakes in the talking part: every candidate that would have opened the orb. */
export function falseWakes(candidates: ResolvedCandidate[]): number {
  return candidates.filter((c) => outcome(c) === 'woke').length;
}

/** The share of the takes' lowest peak the line sits at, as the takes' own line does (verify.rs). */
const LINE_SHARE = 0.8;
/** Fewer near hits than this say too little to move the line. */
const FEWEST = 3;

/**
 * The "hey goose" line the phrase part suggests: just under the weakest peak the phrase reached in
 * a voice taught here, within the line's range. Null when it would not move, or there is too little
 * to go on (nobody taught, or under three candidates in a taught voice).
 */
export function suggestedLine(candidates: WakeTestCandidate[], voices: PhoneVoices): number | null {
  if (voices.people.length === 0) return null;
  const mine = candidates.filter((c) => c.voice !== null && c.voice >= voices.reject).map((c) => c.p);
  if (mine.length < FEWEST) return null;
  const line = Math.min(Math.max(LINE_SHARE * Math.min(...mine), voices.floor), voices.strict);
  return Math.abs(line - voices.cnn) < 0.005 ? null : line;
}
