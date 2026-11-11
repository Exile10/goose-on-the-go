/**
 * The wake word's voice check on this phone: once anyone is taught here, only their voices can
 * wake it (docs/ASSISTANT.md).
 *
 * Each teach take the Pond accepts is also kept here (`enrolPhoneTake`) as its "hey goose" score and
 * a voice embedding, never as audio, in the app's private files. The embedding comes from the Pond's
 * own speaker model, fetched from the Pond once (`ensureSpeakerModel`) and checked against the
 * checksum the app carries. Forgetting a voice on the Pond forgets it here too.
 *
 * The wake test (`runWakeTest`) runs the listening service's own pipeline over a recording and asks
 * the Pond about the candidates the service would have asked it about.
 *
 * Every call is safe where the phone cannot listen: it does nothing and says so in the log.
 */

import { resolveCandidates, type ResolvedCandidate } from '@/models/wake-test';
import { api } from '@/services/api-client';
import { wakeBridge, type PhoneVoices } from '@/services/phone-wake';
import { discardFile } from '@/services/voice-io';

/** What the voice check knows here; null where the phone cannot listen or the module failed. */
export async function phoneVoices(): Promise<PhoneVoices | null> {
  const native = wakeBridge();
  if (!native) return null;
  try {
    return await native.voices();
  } catch (e) {
    console.warn('[wake] could not read the voices taught here', { kind: 'phone_wake_voices', error: String(e) });
    return null;
  }
}

let installing: Promise<boolean> | null = null;

/** The Pond's speaker model on this phone, fetched once; resolves whether it is here. */
export function ensureSpeakerModel(): Promise<boolean> {
  const native = wakeBridge();
  if (!native) return Promise.resolve(false);
  installing ??= (async () => {
    try {
      if ((await native.voices()).model) return true;
      const uri = await api.downloadSpeakerModel();
      const kept = await native.installSpeakerModel(uri);
      console.info('[wake] speaker model fetched from the Pond', { kind: 'phone_wake_voices', kept });
      return kept;
    } catch (e) {
      console.warn('[wake] could not fetch the speaker model', { kind: 'phone_wake_voices', error: String(e) });
      return false;
    } finally {
      installing = null;
    }
  })();
  return installing;
}

/**
 * After the Pond accepted a teach take: keep its score and voice here too. Resolves whether it was
 * kept; a failure is logged and never fails the take, which the Pond already has.
 */
export async function enrolPhoneTake(fileUri: string, profileId: string): Promise<boolean> {
  const native = wakeBridge();
  if (!native) return false;
  if (!(await ensureSpeakerModel())) return false;
  try {
    const { peak, takes } = await native.enrolTake(fileUri, profileId);
    console.info('[wake] take kept for the voice check', { kind: 'phone_wake_voices', peak, takes });
    return true;
  } catch (e) {
    console.warn('[wake] a take was not kept for the voice check', { kind: 'phone_wake_voices', error: String(e) });
    return false;
  }
}

/** Forget a person's voice on this phone, as on the Pond. */
export async function forgetPhoneVoice(profileId: string): Promise<void> {
  const native = wakeBridge();
  if (!native) return;
  try {
    await native.forgetVoice(profileId);
    console.info('[wake] voice forgotten on this phone', { kind: 'phone_wake_voices' });
  } catch (e) {
    console.warn('[wake] could not forget a voice on this phone', { kind: 'phone_wake_voices', error: String(e) });
  }
}

/** Keep the "hey goose" line a wake test suggested, or go back to the takes' own with null. */
export async function chooseWakeLine(line: number | null): Promise<boolean> {
  const native = wakeBridge();
  if (!native) return false;
  try {
    await native.chooseWakeThreshold(line ?? 0);
    console.info('[wake] wake line chosen', { kind: 'phone_wake_voices', line });
    return true;
  } catch (e) {
    console.warn('[wake] could not keep the wake line', { kind: 'phone_wake_voices', error: String(e) });
    return false;
  }
}

/**
 * The service's pipeline over the recording at `fileUri`, with the Pond's answer for each candidate
 * it would have asked about. Every file the run leaves in the cache is deleted.
 */
export async function runWakeTest(fileUri: string): Promise<ResolvedCandidate[]> {
  const native = wakeBridge();
  if (!native) throw new Error('This phone cannot listen for the wake word');
  const run = await native.testWake(fileUri);
  return resolveCandidates(run.candidates, async (segment) => {
    try {
      return (await api.checkWakeSegment(segment)).heard;
    } catch (e) {
      console.warn('[wake] the Pond could not check a test candidate', { kind: 'phone_wake_voices', error: String(e) });
      return null;
    } finally {
      discardFile(segment);
    }
  });
}
