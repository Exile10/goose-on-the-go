/**
 * The assist overlay: what the phone's assist gesture opens over whatever app is in front.
 *
 * It is a voice conversation and nothing else. It reaches the paired Pond the way a push wake-up
 * does (`ensurePondSession`), because the overlay is its own React tree with no ServerProvider: a
 * running app's connection is reused, and a cold start restores the pairing from storage. The
 * turns themselves are an ordinary conversation (`useChatOn`), so what was said lands on the
 * conversation wall like anything typed, and voice is the same pipeline as voice mode
 * (`useVoice`, inside `VoiceDock`).
 *
 * The overlay closes itself when the conversation ends: the pipeline back at rest after it has
 * listened, which is a goodbye, a tap that stops listening, or eight seconds with nothing said.
 *
 * Over the lock screen, every turn is sent as a locked phone's (`device_locked`): the Pond answers
 * with no personal data or tools, and says to unlock for what needs them. `unlock` asks for the
 * phone's own check, after which turns are the member's again.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Linking from 'expo-linking';

import type { Message } from '@/models/chat';
import type { VoiceState } from '@/models/voice';
import { closeAssist, phoneLocked, unlockPhone } from '@/services/phone-assistant';
import { ensurePondSession } from '@/services/pond-session';
import { useChatOn, type UseChat } from '@/view-models/use-chat';

/** Whether the overlay can talk to the Pond yet. */
export type AssistLink = 'connecting' | 'ready' | 'unreachable';

/** What the overlay shows of the conversation: the last thing asked and its answer so far. */
export interface Exchange {
  asked: string | null;
  answer: string | null;
}

/** How far the voice pipeline has come since the overlay opened. */
export interface VoiceProgress {
  /** It has listened at least once. Until then, `idle` is the moment before the first listen. */
  started: boolean;
  /** Back at rest after listening: the conversation is over. */
  ended: boolean;
}

export const NOT_STARTED: VoiceProgress = { started: false, ended: false };

const ACTIVE = new Set<VoiceState>(['wait', 'recording', 'thinking', 'speaking']);

/** Fold one state of the voice pipeline into how far it has come. */
export function followVoice(progress: VoiceProgress, state: VoiceState): VoiceProgress {
  const started = progress.started || ACTIVE.has(state);
  return { started, ended: started && state === 'idle' };
}

/** The last question in the thread and the answer after it, each null until there is one. */
export function lastExchange(messages: Message[]): Exchange {
  let at = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      at = i;
      break;
    }
  }
  if (at < 0) return { asked: null, answer: null };
  const reply = messages.slice(at + 1).find((m) => m.role === 'assistant');
  return { asked: messages[at].content.trim() || null, answer: reply?.content.trim() || null };
}

/**
 * The overlay always talks to the Pond. It has no Developer screen to flip chat to its mock, and
 * a release build's chat is the real Pond too (`REAL_BY_DEFAULT` in providers/server-provider.tsx).
 */
const toThePond = () => true;

export interface UseAssist {
  data: {
    link: AssistLink;
    exchange: Exchange;
    /** The phone is locked: answers leave out personal data until it is unlocked. */
    locked: boolean;
  };
  actions: {
    send: UseChat['actions']['send'];
    stop: UseChat['actions']['stop'];
    /** Handed to `VoiceDock`: closes the overlay when the conversation ends. */
    voiceChanged: (state: VoiceState) => void;
    close: () => void;
    /** Carry on in the app: this conversation when there is one, else the app's front screen. */
    openApp: () => void;
    /** Ask for the phone's own check over the lock screen. */
    unlock: () => Promise<void>;
  };
}

export function useAssist(): UseAssist {
  const [link, setLink] = useState<AssistLink>('connecting');

  useEffect(() => {
    let live = true;
    void ensurePondSession().then((ready) => {
      if (!live) return;
      console.info('[assist] pond session', { kind: 'assist_overlay', ready });
      setLink(ready ? 'ready' : 'unreachable');
    });
    return () => {
      live = false;
    };
  }, []);

  const chat = useChatOn({ hydrated: link === 'ready', isScreenReal: toThePond });
  const { stop } = chat.actions;
  const sendTurn = chat.actions.send;

  // Read when the overlay opens and after each unlock; a turn reads the ref, never a stale render.
  const [locked, setLocked] = useState(phoneLocked);
  const lockedRef = useRef(locked);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);
  useEffect(() => {
    console.info('[assist] opened', { kind: 'assist_overlay', locked: lockedRef.current });
  }, []);
  const send = useCallback<UseChat['actions']['send']>(
    (text, attachments, options) => sendTurn(text, attachments, { ...options, locked: lockedRef.current }),
    [sendTurn],
  );
  const unlock = useCallback(async () => {
    const unlocked = await unlockPhone();
    const still = phoneLocked();
    lockedRef.current = still;
    setLocked(still);
    if (!unlocked) console.info('[assist] still locked', { kind: 'assist_overlay' });
  }, []);
  const { messages, sessionId } = chat.data;

  const close = useCallback(() => {
    void closeAssist();
  }, []);

  const progress = useRef(NOT_STARTED);
  const voiceChanged = useCallback(
    (state: VoiceState) => {
      const next = followVoice(progress.current, state);
      const endedNow = next.ended && !progress.current.ended;
      progress.current = next;
      if (endedNow) {
        console.info('[assist] conversation over; closing', { kind: 'assist_overlay' });
        close();
      }
    },
    [close],
  );

  // The overlay stops when the app's own screen covers it, which closes it (AssistActivity.onStop).
  // The app does not open over the lock screen, so a locked phone is unlocked first.
  const openApp = useCallback(async () => {
    if (lockedRef.current && !(await unlockPhone())) return;
    const url = sessionId
      ? Linking.createURL('/conversation', { queryParams: { session: sessionId } })
      : Linking.createURL('/');
    Linking.openURL(url).catch((e: unknown) => {
      console.warn('[assist] could not open the app', { kind: 'assist_overlay', error: String(e) });
    });
  }, [sessionId]);

  const exchange = useMemo(() => lastExchange(messages), [messages]);

  return {
    data: { link, exchange, locked },
    actions: { send, stop, voiceChanged, close, openApp: () => void openApp(), unlock },
  };
}
