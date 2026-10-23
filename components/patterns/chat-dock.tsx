/**
 * ChatDock — where a message is written: attach, the field, and speak or send.
 *
 * It floats. The dock used to be a slab the width of the screen with a rule
 * along its top, standing on the strip the tab bar floated over — a chin of
 * chrome nearly a sixth of the screen tall under every conversation. The
 * conversation now opens over the tabs, so the only thing under the dock is the
 * home indicator, and the controls are three pieces of opaque chrome sitting
 * on the page rather than a panel holding them. Solid, not the tab bar's glass,
 * for the reason in `chrome-puck.tsx`.
 *
 * The right-hand control is two in one place. With nothing written it is the
 * microphone, which opens voice mode; once there is something to send it is
 * send, drawn as the screen's one filled accent on Ink's edge, because it is
 * the control actually asking a question. They share a place because they are
 * never both useful at once.
 *
 * It stays live while Goose answers. A follow-up thought mid-reply is the
 * ordinary case, and a field that locked until the model finished made the
 * person hold it in their head; now send queues it behind the reply, and the
 * field says so before anything is typed. A glint running along the field's
 * top border says the reply is still coming, and a reminder under it that
 * Goose can be wrong fades once the reply is in (`answering.tsx`).
 *
 * The dock holds its own draft and attachments. Lifting them into the screen
 * would re-render every message on each keystroke, and nothing above here
 * needs to know what is half-written.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { glassLift, hitSlop } from '@jarida/ink';
import { InkEdge, inkText, useInkTheme } from '@jarida/ink/native';

import { AnsweringEdge, AnsweringNote, NOTE_ROOM } from '@/components/patterns/answering';
import { AttachMenu } from '@/components/patterns/attach-menu';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { selectionTick, tap } from '@/services/haptics';
import type { Attachment, AttachSource } from '@/services/media';
import { Spacing } from '@/constants/spacing';

/** The controls' diameter, and the field's height on one line: the touch floor. */
const CONTROL = 44;

/** The text's own height plus the field's padding, between one line and about five. */
function fieldHeight(content: number): number {
  return Math.min(132, Math.max(CONTROL, Math.ceil(content) + (Platform.OS === 'ios' ? 24 : 16)));
}

/** Past this many the Pond's turn gets heavy and the strip stops fitting a thumb. */
export const MAX_ATTACHMENTS = 4;

export interface ChatDockProps {
  onSend: (text: string, attachments: Attachment[]) => void;
  /** Open voice mode. */
  onVoice: () => void;
  /** Ask for pictures or a file. Resolves with what was chosen, or nothing. */
  onAttach: (source: AttachSource, room: number) => Promise<Attachment[]>;
  /** A turn is in flight: what is sent now waits behind it. */
  busy?: boolean;
  /** The home indicator, when no keyboard is covering it. */
  bottomInset?: number;
}

export function ChatDock({ onSend, onVoice, onAttach, busy, bottomInset = 0 }: ChatDockProps) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [menu, setMenu] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  // The field's height follows its text both ways. Left to itself a multiline
  // field on iOS grows as lines are added and keeps that height once they are
  // gone, so the dock stood two lines tall after every long message.
  const [lines, setLines] = useState(0);

  // With the keyboard up the indicator is under it, and padding for it would
  // leave a gap between the dock and the keys.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setKeyboard(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const hasContent = draft.trim().length > 0 || attachments.length > 0;

  const handleSend = useCallback(() => {
    if (!hasContent) return;
    void tap();
    onSend(draft, attachments);
    setDraft('');
    setAttachments([]);
  }, [attachments, draft, hasContent, onSend]);

  // The menu has already closed by the time it hands over a choice, so the
  // picker is presented from the screen rather than from the menu.
  const choose = useCallback(
    async (source: AttachSource) => {
      const picked = await onAttach(source, MAX_ATTACHMENTS - attachments.length);
      if (picked.length === 0) return;
      void selectionTick();
      setAttachments((current) => [...current, ...picked].slice(0, MAX_ATTACHMENTS));
    },
    [attachments.length, onAttach],
  );

  const remove = useCallback((id: string) => {
    setAttachments((current) => current.filter((a) => a.id !== id));
  }, []);

  const material = {
    backgroundColor: theme.color.chrome,
    borderColor: theme.color.lineStrong,
    borderWidth: theme.edge.hairlineWidth,
  };
  const field = inkText(theme, { size: 'md' });
  // Clear of the keyboard by a full step, not half of one. Vendor keyboards
  // (Samsung's among them) draw a toolbar row of their own inside the height
  // they report, so 8px put the composer visually against that row rather than
  // above it — the input read as part of the keyboard. The note gets a band of
  // its own on top, so it never sits on the home indicator or the keys.
  const foot = (keyboard ? Spacing.lg : bottomInset + Spacing.xs) + NOTE_ROOM;

  return (
    <View pointerEvents="box-none" style={[styles.dock, { paddingBottom: foot }]}>
      {attachments.length > 0 ? (
        <View style={styles.strip}>
          {attachments.map((a) => (
            <View key={a.id} style={[styles.thumb, { borderRadius: theme.radius.md }, material]}>
              {a.kind === 'image' ? (
                <Image source={{ uri: a.uri }} style={styles.thumbImage} contentFit="cover" />
              ) : (
                <View style={styles.fileThumb}>
                  <GIcon name="file" size={20} color={theme.color.textSecondary} />
                </View>
              )}
              <Pressable
                onPress={() => remove(a.id)}
                accessibilityRole="button"
                accessibilityLabel={t('chat.composer.removeAttachment', { name: a.name })}
                hitSlop={8}
                style={[styles.unattach, { backgroundColor: theme.color.chrome }]}
              >
                <GIcon name="x" size={12} color={theme.color.text} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.row}>
        <GPressable
          feedback="lift"
          onPress={() => {
            void selectionTick();
            // The menu hangs from this button, and the button drops back to
            // the foot of the screen once the keyboard is gone.
            Keyboard.dismiss();
            setMenu((open) => !open);
          }}
          disabled={attachments.length >= MAX_ATTACHMENTS}
          accessibilityRole="button"
          accessibilityLabel={t('chat.composer.attach')}
          accessibilityState={{
            expanded: menu,
            disabled: attachments.length >= MAX_ATTACHMENTS,
          }}
          style={[styles.control, material, glassLift(theme)]}
        >
          <GIcon name="plus" size={20} color={theme.color.text} />
        </GPressable>

        <View style={[styles.field, material]}>
          <AnsweringEdge active={Boolean(busy)} radius={CONTROL / 2} />
          <TextInput
            style={[field.style, styles.input, { height: fieldHeight(draft ? lines : 0) }]}
            value={draft}
            onChangeText={setDraft}
            onContentSizeChange={(e) => setLines(e.nativeEvent.contentSize.height)}
            placeholder={busy ? t('chat.queuePlaceholder') : t('chat.placeholder')}
            placeholderTextColor={theme.color.textTertiary}
            multiline
            maxLength={4000}
            accessibilityLabel={busy ? t('chat.queuePlaceholder') : t('chat.placeholder')}
          />
        </View>

        {hasContent ? (
          <Pressable
            onPress={handleSend}
            accessibilityRole="button"
            accessibilityLabel={busy ? t('chat.queue') : t('chat.send')}
            hitSlop={hitSlop(CONTROL)}
          >
            {({ pressed }) => (
              <InkEdge
                radius={theme.radius.pill}
                edge={theme.edgeCompact}
                state={pressed ? 'pressed' : 'rest'}
                contentStyle={[styles.send, { backgroundColor: theme.color.accent }]}
              >
                <GIcon name="send" size={18} color={theme.color.textOnAccent} />
              </InkEdge>
            )}
          </Pressable>
        ) : (
          <GPressable
            feedback="lift"
            onPress={() => {
              void selectionTick();
              onVoice();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('chat.voice.open')}
            style={[styles.control, material, glassLift(theme)]}
          >
            <GIcon name="mic" size={20} color={theme.color.text} />
          </GPressable>
        )}
        <AnsweringNote active={Boolean(busy)} />
      </View>

      <AttachMenu
        open={menu}
        onClose={() => setMenu(false)}
        onChoose={choose}
        anchorBottom={foot + CONTROL}
        anchorLeft={Spacing.lg}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  control: {
    width: CONTROL,
    height: CONTROL,
    borderRadius: CONTROL / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    flex: 1,
    minHeight: CONTROL,
    borderRadius: CONTROL / 2,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
  },
  input: {
    maxHeight: 132,
    paddingTop: Platform.OS === 'ios' ? 12 : 8,
    paddingBottom: Platform.OS === 'ios' ? 12 : 8,
  },
  // Four points under the others, because the plate adds four to the edge's
  // footprint and the three controls should read as one height.
  send: {
    width: CONTROL - 4,
    height: CONTROL - 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strip: { flexDirection: 'row', gap: Spacing.sm, paddingLeft: CONTROL + Spacing.sm },
  thumb: { width: 60, height: 60, overflow: 'hidden' },
  thumbImage: { width: '100%', height: '100%' },
  fileThumb: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  unattach: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
