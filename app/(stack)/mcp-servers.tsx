/**
 * McpServersScreen — Server cards with status dots, latency,
 * and configure/remove/retry actions.
 */

import { useTranslation } from 'react-i18next';
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { Grey, JaridaPurple, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';
import type { TranslationKey } from '@/services/i18n';

interface McpServer {
  id: string;
  name: string;
  url: string;
  status: 'online' | 'offline' | 'error';
  latency: string;
  tools: number;
}

const SERVERS: McpServer[] = [
  { id: '1', name: 'Uber MCP', url: 'mcp.uber.internal:8443', status: 'online', latency: '45ms', tools: 6 },
  { id: '2', name: 'Glovo MCP', url: 'mcp.glovo.internal:8443', status: 'error', latency: '--', tools: 4 },
  { id: '3', name: 'Spotify MCP', url: 'mcp.spotify.internal:8443', status: 'online', latency: '32ms', tools: 8 },
  { id: '4', name: 'Hue Bridge', url: '192.168.1.42:443', status: 'online', latency: '12ms', tools: 3 },
  { id: '5', name: 'Dev Server', url: 'localhost:3000', status: 'offline', latency: '--', tools: 12 },
];

const STATUS_COLORS: Record<string, string> = {
  online: Semantic.success,
  offline: Grey[400],
  error: Semantic.danger,
};

/** Server card */
/** One literal key per status, so the key-completeness test can see every one. */
function statusKey(status: McpServer['status']): TranslationKey {
  switch (status) {
    case 'online': return 'integrations.online';
    case 'offline': return 'integrations.offline';
    case 'error': return 'integrations.error';
  }
}

const ServerCard = React.memo(function ServerCard({ server }: { server: McpServer }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const statusColor = STATUS_COLORS[server.status];
  return (
    <View style={styles.serverCard}>
      <View style={styles.serverHeader}>
        <View style={styles.serverNameRow}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={styles.serverName}>{server.name}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '18' }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>
            {t(statusKey(server.status))}
          </Text>
        </View>
      </View>

      <Text style={styles.serverUrl}>{server.url}</Text>

      <View style={styles.metricsRow}>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>{t('integrations.latency')}</Text>
          <Text style={styles.metricValue}>{server.latency}</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>{t('integrations.tools')}</Text>
          <Text style={styles.metricValue}>{server.tools}</Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actionsRow}>
        <GPressable style={styles.actionBtn}>
          <GIcon name="settings" size={14} color={Grey[500]} />
          <Text style={styles.actionText}>{t('integrations.configure')}</Text>
        </GPressable>
        {server.status === 'error' && (
          <GPressable style={styles.actionBtn}>
            <GIcon name="refresh" size={14} color={Semantic.warning} />
            <Text style={[styles.actionText, { color: Semantic.warning }]}>{t('common.retry')}</Text>
          </GPressable>
        )}
        <GPressable style={styles.actionBtn}>
          <GIcon name="trash" size={14} color={Semantic.danger} />
          <Text style={[styles.actionText, { color: Semantic.danger }]}>{t('common.remove')}</Text>
        </GPressable>
      </View>
    </View>
  );
});

export default function McpServersScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {SERVERS.map((s) => (
        <ServerCard key={s.id} server={s} />
      ))}

      {/* Add server button */}
      <GPressable feedback="lift" style={styles.addBtn}>
        <GIcon name="plus" size={18} color={JaridaPurple[500]} />
        <Text style={styles.addBtnText}>{t('integrations.addServer')}</Text>
      </GPressable>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },

    /* Server card */
    serverCard: {
      backgroundColor: c.card,
      borderRadius: Radii.xl,
      padding: Spacing.lg,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: Spacing.md,
    },
    serverHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: Spacing.sm,
    },
    serverNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    serverName: {
      fontFamily: FontFamily.heading,
      fontSize: FontSize.md,
      fontWeight: FontWeight.bold,
      color: c.text,
    },
    statusBadge: {
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: Radii.pill,
    },
    statusText: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.bold,
    },
    serverUrl: {
      fontFamily: FontFamily.mono,
      fontSize: FontSize.xs,
      color: c.textTertiary,
      marginBottom: Spacing.md,
    },

    /* Metrics */
    metricsRow: {
      flexDirection: 'row',
      gap: Spacing.xl,
      marginBottom: Spacing.md,
      paddingBottom: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    metric: {},
    metricLabel: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.xs,
      color: Grey[400],
    },
    metricValue: {
      fontFamily: FontFamily.mono,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: c.text,
      marginTop: 2,
    },

    /* Actions */
    actionsRow: {
      flexDirection: 'row',
      gap: Spacing.lg,
    },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    actionText: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.medium,
      color: c.textTertiary,
    },

    /* Add button */
    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      paddingVertical: Spacing.lg,
      borderRadius: Radii.xl,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: JaridaPurple[200],
      backgroundColor: c.tintSoft,
    },
    addBtnText: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: c.textBrand,
    },
  });
