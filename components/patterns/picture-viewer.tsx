/**
 * A picture in the conversation, opened to fill the screen: one the person sent, or one the Pond
 * kept for an answer's page. It loads the way the thread does, through the Pond's pinned
 * connection, and it can be answered from here.
 */

import React, { useEffect } from 'react';
import { Keyboard, Modal, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { InkButton, inkText, useInkTheme } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import type { ReplyPicture } from '@/services/reply';
import { usePondImage } from '@/view-models/use-pond-image';

/** Dark whatever the theme: a picture is judged against black, as a photos app shows it. */
const BLACK = '#000';
const WHITE = '#fff';

export function PictureViewer({
  picture,
  onClose,
  onReply,
}: {
  picture: ReplyPicture | null;
  onClose: () => void;
  onReply?: (picture: ReplyPicture) => void;
}) {
  // A picture is looked at, not typed under: the keyboard would cover it and its Reply.
  useEffect(() => {
    if (picture) Keyboard.dismiss();
  }, [picture]);
  return (
    <Modal visible={picture !== null} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {picture ? <Viewer picture={picture} onClose={onClose} onReply={onReply} /> : null}
    </Modal>
  );
}

function Viewer({
  picture,
  onClose,
  onReply,
}: {
  picture: ReplyPicture;
  onClose: () => void;
  onReply?: (picture: ReplyPicture) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const pond = usePondImage(picture.local ? null : picture.uri);
  const uri = picture.local ? picture.uri : pond.uri;
  const theme = useInkTheme();
  const label = inkText(theme, { size: 'sm', color: WHITE });
  return (
    <View style={styles.backdrop}>
      {/* iOS zooms a scroll view by pinching; Android shows the picture whole, which is the main thing. */}
      <ScrollView
        maximumZoomScale={4}
        minimumZoomScale={1}
        centerContent
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.stage}
      >
        {uri ? (
          <Image
            source={{ uri }}
            style={{ width: screen.width, height: screen.height }}
            contentFit="contain"
            accessibilityLabel={picture.label}
          />
        ) : (
          <GIcon name={pond.failed ? 'eye-off' : 'camera'} size={28} color={WHITE} />
        )}
      </ScrollView>
      <View style={[styles.top, { top: insets.top + 8 }]}>
        <GPressable
          feedback="lift"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('chat.picture.close')}
          hitSlop={8}
          style={styles.close}
        >
          <GIcon name="x" size={20} color={WHITE} />
        </GPressable>
      </View>
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
        {picture.label ? (
          <Text style={[label.style, styles.caption]} numberOfLines={2}>
            {picture.label}
          </Text>
        ) : null}
        {onReply ? (
          <InkButton
            icon={<GIcon name="reply" size={18} color={theme.color.textOnAccent} />}
            onPress={() => {
              onReply(picture);
              onClose();
            }}
          >
            {t('chat.picture.reply')}
          </InkButton>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: BLACK },
  stage: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', left: 16 },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  bottom: { position: 'absolute', left: 16, right: 16, bottom: 0, gap: 12, alignItems: 'flex-start' },
  caption: { color: WHITE, opacity: 0.8 },
});
