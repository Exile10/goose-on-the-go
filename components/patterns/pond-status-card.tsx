/**
 * The paired Pond and how the connection to it stands, as a card at the top of a screen's content:
 * Home while the Pond does not answer, and the top of Switch Pond always.
 *
 * It carries the same state as the connection strip (`useConnectionStatus`), told in full: what is
 * happening, why when the checks say, when the Pond last answered, when the next check runs, and
 * Try now. The strip stays off the screens that draw this, so the state is told once.
 */

import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkEyebrow, InkText } from '@/components/ui/ink';

import { GIcon } from '@/components/ui/g-icon';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ConnectionPhase } from '@/models/connection';
import { useConnectionStatus } from '@/view-models/use-connection-status';
import type { ThemeColors } from '@/constants/colors';
import { FontSize, face } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';

export interface PondStatusCardProps {
  /** The Pond's advertised name, when it was heard on this network. */
  name?: string;
  /** Its address as a person reads it, `192.168.1.10:4443`. */
  address: string;
  /** A line on what the screen will show once the Pond answers. */
  note?: string;
  /** Offers Switch Pond, for a screen that is not Switch Pond itself. */
  onSwitch?: () => void;
  /** Layout from the screen around it, such as Home spacing its cards itself. */
  style?: StyleProp<ViewStyle>;
}

export function PondStatusCard({ name, address, note, onSwitch, style }: PondStatusCardProps) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const status = useConnectionStatus();
  const label = status.reason ? `${status.title}. ${status.reason}` : status.title;

  return (
    <InkCard style={[styles.card, style]} contentStyle={styles.content}>
      <InkEyebrow>{t('pond.yours')}</InkEyebrow>
      <View style={styles.identity}>
        <GIcon name="server" size={18} />
        <View style={styles.identityText}>
          <Text style={styles.name} numberOfLines={1}>
            {name || address}
          </Text>
          {name && address ? <Text style={styles.address}>{address}</Text> : null}
        </View>
      </View>

      <View style={styles.state} accessible accessibilityLiveRegion="polite" accessibilityLabel={label}>
        <View style={[styles.dot, dotStyle(styles, status.phase)]} />
        <View style={styles.stateText}>
          <InkText weight="semibold">{status.title}</InkText>
          {status.reason ? <InkText tone="secondary">{status.reason}</InkText> : null}
        </View>
      </View>
      {status.lastConnected || status.next ? (
        <View style={styles.facts}>
          {status.lastConnected ? <InkText size="sm" tone="tertiary">{status.lastConnected}</InkText> : null}
          {status.next ? <InkText size="sm" tone="tertiary">{status.next}</InkText> : null}
        </View>
      ) : null}
      {note ? <InkText tone="secondary">{note}</InkText> : null}

      {status.phase === 'pairing' || status.retryable || onSwitch ? (
        <View style={styles.actions}>
          {status.phase === 'pairing' ? (
            <InkButton variant="primary" icon="link" onPress={() => router.push('/(stack)/pond-pairing')}>
              {t('connection.actionPair')}
            </InkButton>
          ) : status.retryable ? (
            <InkButton variant="primary" icon="refresh" loading={status.checking} onPress={status.tryNow}>
              {t('connection.tryNow')}
            </InkButton>
          ) : null}
          {onSwitch ? (
            <InkButton variant="quiet" icon="server" onPress={onSwitch}>
              {t('pond.switch')}
            </InkButton>
          ) : null}
        </View>
      ) : null}
    </InkCard>
  );
}

function dotStyle(styles: ReturnType<typeof makeStyles>, phase: ConnectionPhase) {
  switch (phase) {
    case 'connected':
      return styles.dotGood;
    case 'connecting':
    case 'reconnecting':
      return styles.dotWaiting;
    case 'unreachable':
    case 'trust':
    case 'pairing':
      return styles.dotBad;
  }
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    /* The plate sits 4px below the face, so every card reserves room for it. */
    card: { marginBottom: Spacing.lg },
    content: { gap: Spacing.md },
    identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    identityText: { flex: 1 },
    name: { ...face('body', 'semibold'), fontSize: FontSize.md, color: c.text },
    address: { ...face('mono', 'regular'), fontSize: FontSize.xs, color: c.textTertiary },
    state: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
    stateText: { flex: 1, gap: 2 },
    dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
    dotGood: { backgroundColor: c.success },
    dotWaiting: { backgroundColor: c.warning },
    dotBad: { backgroundColor: c.danger },
    facts: { gap: 2, paddingLeft: Spacing.sm + 8 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  });
