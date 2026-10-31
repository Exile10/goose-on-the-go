/**
 * ChatScreen — the conversation with Goose.
 *
 * It opens over the whole app, not inside the Chat tab: a conversation is the
 * one screen that is all content, and the tab bar under its composer was a
 * chin of chrome nobody reached for mid-sentence. Back returns to the wall.
 *
 * What carries it:
 *
 * - **The turn as it happens.** Every reply streams. Each tool Goose calls
 *   appears as it calls it — a chip while it runs, a card once the answer is a
 *   thing worth drawing — and the words arrive as they are written. Until the
 *   first of them, the thinking line says what the Pond is doing and a quip
 *   keeps the wait alive.
 * - **An opening worth having.** A new conversation is the greeting card, and
 *   under it what the Pond itself offers to answer, not a fixed list.
 * - **Writing never waits for the answer.** What is sent mid-reply queues at
 *   the foot of the thread, marked as queued, and goes when the reply ends.
 * - **Voice in the composer's place.** The microphone swaps the composer for
 *   the orb; the keyboard swaps it back. The conversation stays on screen
 *   either way, and what is said out loud lands in it like anything typed.
 *
 * The title bar names the conversation, not the assistant: every conversation
 * is with Goose, so "Goose" over each of them said nothing. The wall's own
 * title arrives with the link so the bar is right on the first frame; a new
 * conversation takes the title the Pond will give it the moment it is asked,
 * and the Pond's own replaces it after each reply. Until anything is asked the
 * bar has no title — the greeting card under it already says "New chat".
 *
 * - **Reading back is left alone.** A reader well back in the thread is not
 *   pulled down by a reply arriving at its foot; the list holds what they are
 *   reading where it is, and a round arrow offers the way back to the newest
 *   message, with a dot when something arrived meanwhile
 *   (`view-models/latest-button.ts`).
 *
 * The header reports reachability only when it is bad. A green dot reading
 * "Connected" above every conversation is chrome; an explicit line when the
 * Pond cannot be reached is the thing a reader actually needs.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NAVBAR_DEFAULTS, NavbarBehaviour, type NavbarStage } from '@jarida/ink/headless';
import { InkNavbar, InkNotice, useInkTheme, useReduceMotion } from '@jarida/ink/native';

import { ChatDock } from '@/components/patterns/chat-dock';
import { GreetingCard } from '@/components/patterns/greeting-card';
import { JumpToLatest } from '@/components/patterns/jump-to-latest';
import { MessageRow } from '@/components/patterns/message-row';
import { VoiceDock } from '@/components/patterns/voice-dock';
import { GIcon } from '@/components/ui/g-icon';
import { GKeyboardView } from '@/components/ui/g-keyboard-view';
import { GPressable } from '@/components/ui/g-pressable';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';
import { selectionTick } from '@/services/haptics';
import { AttachError, pickAttachments, withinTurnLimit, type Attachment, type AttachSource } from '@/services/media';
import type { Message } from '@/models/chat';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import {
  HIDDEN,
  afterScroll,
  holdPlace,
  isBackInThread,
  footKey,
  hasUnseen,
  type LatestButton,
} from '@/view-models/latest-button';
import { positionsFor, useChat, type SendOptions } from '@/view-models/use-chat';
import { useResearchOffer } from '@/view-models/use-deep-research';
import { useGreetingName } from '@/view-models/use-greeting';
import { useSuggestions, type OfferedPrompt } from '@/view-models/use-suggestions';
import type { BubblePosition } from '@jarida/ink/native';

/** The phone number for when the title bar condenses; see `chrome-provider.tsx`. */
const BEHAVIOUR = { ...NAVBAR_DEFAULTS, collapseAt: 120 };

/** One row of the inverted list: a message, where it sits in its run, and whether it is still waiting. */
interface Row {
  message: Message;
  position: BubblePosition;
  queued: boolean;
}

/**
 * The way back to the wall, at the head of the bar.
 *
 * The root stack keeps the tabs under this screen, so `back` is the ordinary
 * case. `replace` is for the one way to arrive without them: a link opened
 * cold, with nothing to go back to.
 */
function BackToWall() {
  const router = useRouter();
  const theme = useInkTheme();
  const { t } = useTranslation();

  const onPress = useCallback(() => {
    void selectionTick();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/chat');
  }, [router]);

  return (
    <GPressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={t('chat.history.back')}
      style={localStyles.back}
    >
      <GIcon name="chevron-left" size={22} color={theme.color.text} />
    </GPressable>
  );
}

export default function ChatScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { data, error, actions } = useChat();
  const { online, hydrated } = useServer();
  const { messages, queued, streaming, status, turnSeed, sessionId, title } = data;
  const name = useGreetingName();
  const suggestions = useSuggestions(sessionId);
  const research = useResearchOffer();
  const [voice, setVoice] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // The wall and Home link a conversation here by id, with the title they show
  // for it; without an id the screen opens a new conversation, which is what
  // the wall's compose button means. The ref is what stops a re-render
  // re-reading a conversation already on screen.
  const { session, title: linkedTitle } = useLocalSearchParams<{ session?: string; title?: string }>();
  const openedRef = useRef<string | null>(null);
  const { open, unqueue } = actions;
  useEffect(() => {
    if (!session || openedRef.current === session) return;
    openedRef.current = session;
    open(session, linkedTitle);
  }, [session, linkedTitle, open]);

  // This screen is outside the tabs, so it has no shared bar to follow. The
  // title bar reads the list's own scroll through Ink's state machine, and
  // stops at condensed: Ink's navbar shrinks its body at `collapsed` whether
  // or not it may draw the puck that gets it back.
  const [behaviour] = useState(() => new NavbarBehaviour(BEHAVIOUR));
  const [stage, setStage] = useState<NavbarStage>('expanded');
  // The same scroll decides whether the way back to the newest message shows.
  // The list is inverted, so its offset is already the distance from the foot.
  // The foot is the newest row the list draws: the last queued message, else
  // the last message. When it moves behind a reader back in the thread, the
  // arrow carries a dot.
  const [latest, setLatest] = useState<LatestButton>(HIDDEN);
  // Whether the reader is back in the thread, the only time the list holds
  // their place (see `holdPlace`).
  const [back, setBack] = useState(false);
  const foot = footKey(queued[queued.length - 1] ?? messages[messages.length - 1]);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement } = e.nativeEvent;
      const next = behaviour.scrolled(contentOffset.y);
      setStage(next === 'collapsed' ? 'condensed' : next);
      setLatest((state) => afterScroll(state, contentOffset.y, layoutMeasurement.height, foot));
      setBack(isBackInThread(contentOffset.y));
    },
    [behaviour, foot],
  );

  const listRef = useRef<FlatList<Row>>(null);
  const reduceMotion = useReduceMotion();
  const scrollToFoot = useCallback(() => {
    setLatest(HIDDEN);
    // Before the scroll event says so: a message sent now lands in the next
    // render, which must not still be holding the place the reader just left.
    setBack(false);
    listRef.current?.scrollToOffset({ offset: 0, animated: !reduceMotion });
  }, [reduceMotion]);
  const toLatest = useCallback(() => {
    void selectionTick();
    scrollToFoot();
  }, [scrollToFoot]);

  // Whether the model serving chat can read pictures, asked once. Unknown is
  // treated as yes: the Pond's own refusal is clearer than a guess here.
  const [vision, setVision] = useState<boolean | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    let live = true;
    void (async () => {
      try {
        const caps = await api.modelCapabilities();
        if (live) setVision(caps.vision);
      } catch {
        // Leave it unknown.
      }
    })();
    return () => {
      live = false;
    };
  }, [hydrated]);

  const onAttach = useCallback(
    async (source: AttachSource, room: number): Promise<Attachment[]> => {
      setNotice(null);
      if (vision === false && source !== 'files') {
        setNotice(t('chat.composer.noVision'));
        return [];
      }
      try {
        const picked = await pickAttachments(source, room);
        if (vision === false && picked.some((a) => a.kind === 'image')) {
          setNotice(t('chat.composer.noVision'));
          return picked.filter((a) => a.kind !== 'image');
        }
        return picked;
      } catch (e) {
        setNotice(e instanceof AttachError ? t(e.key) : t('chat.composer.unreadable'));
        return [];
      }
    },
    [t, vision],
  );

  const onSend = useCallback(
    (text: string, attachments: Attachment[], options?: Pick<SendOptions, 'research' | 'answer'>) => {
      if (!withinTurnLimit(attachments)) {
        setNotice(t('chat.composer.turnTooLarge'));
        return;
      }
      setNotice(null);
      // What the reader just wrote is where they are now, however far back
      // they had been reading.
      scrollToFoot();
      void actions.send(text, attachments, options);
    },
    [actions, scrollToFoot, t],
  );

  const onPick = useCallback(
    (prompt: OfferedPrompt) => {
      suggestions.actions.taken(prompt);
      void actions.send(prompt.prompt);
    },
    [actions, suggestions.actions],
  );

  const handleNew = useCallback(() => {
    void selectionTick();
    openedRef.current = null;
    behaviour.set('expanded');
    setStage('expanded');
    setLatest(HIDDEN);
    setBack(false);
    actions.newConversation();
  }, [actions, behaviour]);

  // Runs are read in speaking order, then reversed for `inverted`. What is
  // queued comes last, where it will be asked; a queued message keeps its id
  // when it is sent, so its row stays put and only stops waiting.
  const rows: Row[] = useMemo(() => {
    const thread = [...messages, ...queued];
    const positions = positionsFor(thread);
    return thread
      .map((m, i) => ({ message: m, position: positions[i], queued: i >= messages.length }))
      .reverse();
  }, [messages, queued]);

  const keyExtractor = useCallback((row: Row) => row.message.id, []);
  const renderItem = useCallback(
    ({ item }: { item: Row }) => (
      <MessageRow
        message={item.message}
        position={item.position}
        status={item.message.pending ? status : null}
        turnSeed={turnSeed}
        queued={item.queued}
        onUnqueue={unqueue}
      />
    ),
    [status, turnSeed, unqueue],
  );

  const started = messages.length > 0 || queued.length > 0;
  const shown = notice ?? error;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <GKeyboardView style={styles.flex}>
        {/* `alignSelf: flex-end` plus an undefined width makes the bar hug its
            own content on the right until its first layout lands. Stretching it
            is what keeps the title on the left, where a title belongs. */}
        <InkNavbar
          variant="static"
          style={styles.navbar}
          stage={stage}
          lead={<BackToWall />}
          title={title ?? undefined}
          actions={[
            {
              key: 'new',
              label: t('chat.newConversation'),
              icon: 'compose',
              onPress: handleNew,
            },
          ]}
        />

        {!online && hydrated ? (
          <View style={styles.notice}>
            <InkNotice tone="warning">{t('chat.offlineBody')}</InkNotice>
          </View>
        ) : null}

        {shown ? (
          <GPressable
            feedback="tint"
            onPress={() => {
              setNotice(null);
              actions.dismissError();
            }}
            accessibilityRole="button"
            accessibilityHint={t('chat.dismiss')}
            style={styles.notice}
          >
            <InkNotice tone={notice ? 'warning' : 'danger'}>{shown}</InkNotice>
          </GPressable>
        ) : null}

        <View style={styles.conversation}>
          {started ? (
            <FlatList
              ref={listRef}
              data={rows}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              inverted
              onScroll={onScroll}
              scrollEventThrottle={16}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              maintainVisibleContentPosition={holdPlace(back)}
            />
          ) : (
            <View style={styles.opening}>
              <GreetingCard
                name={name}
                seed={turnSeed}
                busy={streaming}
                prompts={suggestions.data.prompts}
                onPick={onPick}
              />
            </View>
          )}
          {started && latest.visible ? (
            <View pointerEvents="box-none" style={styles.latest}>
              <JumpToLatest onPress={toLatest} unseen={hasUnseen(latest, foot)} />
            </View>
          ) : null}
        </View>

        {voice ? (
          <VoiceDock
            send={actions.send}
            stop={actions.stop}
            onClose={() => setVoice(false)}
            bottomInset={insets.bottom}
          />
        ) : (
          <ChatDock
            onSend={onSend}
            onVoice={() => setVoice(true)}
            onAttach={onAttach}
            busy={streaming}
            bottomInset={insets.bottom}
            research={research}
            conversation={sessionId}
          />
        )}
      </GKeyboardView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    flex: { flex: 1 },
    navbar: { alignSelf: 'stretch' },

    conversation: { flex: 1, overflow: 'hidden' },
    listContent: {
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
    },

    notice: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },

    // Over the foot of the thread, centred, clear of the composer under it.
    latest: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: Spacing.md,
      alignItems: 'center',
    },

    opening: {
      flex: 1,
      justifyContent: 'flex-end',
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.lg,
    },
  });

/* Nothing themed in here, so it needs no factory. */
const localStyles = StyleSheet.create({
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
