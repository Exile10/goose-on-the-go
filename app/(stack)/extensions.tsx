/**
 * ExtensionsScreen — the Pond's built-in extensions, and the marketplace to add more.
 *
 * Replaces the old "App Integrations" and "MCP Servers" screens: the Pond is
 * one process with a fixed set of extensions, not several remote MCP servers,
 * so there is no per-item URL or latency to show (#92).
 */

import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import React, { useCallback, useState } from 'react';
import { InkButton, InkEmptyState, InkNotice, InkSpinner, InkSwitch, InkText, InkTitle } from '@jarida/ink/native';
import { View, Text, StyleSheet, ScrollView, TextInput } from 'react-native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { GKeyboardView } from '@/components/ui/g-keyboard-view';
import { isIconName } from '@/constants/icons';
import { Grey, JaridaPurple, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';
import { api } from '@/services/api-client';
import type { Extension, MarketplaceExtension, SecretRequirement } from '@/services/types';
import { useExtensions } from '@/view-models/use-extensions';
import { describeApiError } from '@/view-models/describe-error';

const STATUS_COLORS: Record<string, string> = {
  connected: Semantic.success,
  error: Semantic.danger,
  loading: Grey[400],
};

/** One literal key per status, so the key-completeness test can see every one. */
function statusLabel(status: string, t: TFunction): string | null {
  switch (status) {
    case 'connected': return t('extensions.status.connected');
    case 'error': return t('extensions.status.error');
    case 'loading': return t('extensions.status.loading');
    default: return null;
  }
}

/** Installed extension card: toggle plus whatever status the Pond reported. */
const InstalledCard = React.memo(function InstalledCard({
  extension,
  onToggle,
}: {
  extension: Extension;
  onToggle: (name: string, enabled: boolean) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const statusColor = extension.status ? STATUS_COLORS[extension.status] : undefined;
  const statusText = extension.status ? statusLabel(extension.status, t) : null;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.iconWrap}>
          <GIcon name={isIconName(extension.kind) ? extension.kind : 'package'} size={20} color={JaridaPurple[500]} />
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardName}>{extension.name}</Text>
          <Text style={styles.cardDesc} numberOfLines={2}>{extension.description}</Text>
        </View>
        <InkSwitch checked={extension.enabled} onChange={(next) => onToggle(extension.name, next)} />
      </View>

      {statusColor && statusText ? (
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{statusText}</Text>
        </View>
      ) : null}

      {extension.last_error ? (
        <Text style={styles.errorText}>{extension.last_error}</Text>
      ) : null}
    </View>
  );
});

/** One secret field within a post-install setup prompt. Write-only: nothing typed here is ever read back. */
const SecretField = React.memo(function SecretField({ requirement }: { requirement: SecretRequirement }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.setSecret(requirement.key, value.trim());
      setSaved(true);
      setValue('');
    } catch (e) {
      setError(describeApiError(e) ?? t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }, [requirement.key, t, value]);

  return (
    <View style={styles.secretField}>
      <Text style={styles.secretLabel}>{requirement.display_name}</Text>
      {requirement.description ? <Text style={styles.secretDesc}>{requirement.description}</Text> : null}
      {saved ? (
        <View style={styles.secretSavedRow}>
          <GIcon name="check" size={14} color={Semantic.success} />
          <Text style={styles.secretSavedText}>{t('extensions.secretSaved')}</Text>
        </View>
      ) : (
        <View style={styles.secretInputRow}>
          <TextInput
            style={styles.secretInput}
            value={value}
            onChangeText={setValue}
            secureTextEntry
            placeholder={t('extensions.secretPlaceholder')}
            placeholderTextColor={Grey[400]}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <GPressable onPress={handleSave} disabled={saving || !value.trim()}>
            <Text style={styles.secretSaveText}>{saving ? t('extensions.saving') : t('common.save')}</Text>
          </GPressable>
        </View>
      )}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
});

/** Shown right after a successful install, for whatever credentials that extension needs. */
function SetupPrompt({ item, onDone }: { item: MarketplaceExtension; onDone: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const credentialed = item.required_secrets.filter((s) => s.kind !== 'oauth_flow');
  const oauthOnly = item.required_secrets.filter((s) => s.kind === 'oauth_flow');

  return (
    <View style={styles.setupCard}>
      <Text style={styles.setupTitle}>{t('extensions.setupTitle', { name: item.name })}</Text>
      {credentialed.map((req) => (
        <SecretField key={req.key} requirement={req} />
      ))}
      {oauthOnly.map((req) => (
        <View key={req.key} style={styles.oauthNotice}>
          <GIcon name="external" size={14} color={Grey[400]} />
          <Text style={styles.oauthNoticeText}>{t('extensions.oauthPending', { name: req.display_name })}</Text>
        </View>
      ))}
      <InkButton variant="quiet" onPress={onDone}>{t('common.done')}</InkButton>
    </View>
  );
}

/** Marketplace entry not yet installed. */
const MarketplaceCard = React.memo(function MarketplaceCard({
  item,
  installing,
  onInstall,
}: {
  item: MarketplaceExtension;
  installing: boolean;
  onInstall: (item: MarketplaceExtension) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.iconWrap}>
          <GIcon name={isIconName(item.kind) ? item.kind : 'package'} size={20} color={JaridaPurple[500]} />
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardName}>{item.name}</Text>
          <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
        </View>
      </View>

      <View style={styles.categoryRow}>
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryText}>{item.category}</Text>
        </View>
        <InkButton
          variant="quiet"
          icon="plus"
          onPress={() => onInstall(item)}
          disabled={installing}
        >
          {installing ? t('extensions.installing') : t('extensions.install')}
        </InkButton>
      </View>
    </View>
  );
});

export default function ExtensionsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { data, loading, error, actions } = useExtensions();
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [setupFor, setSetupFor] = useState<MarketplaceExtension | null>(null);

  const handleToggle = useCallback(
    (name: string, enabled: boolean) => void actions.setEnabled(name, enabled),
    [actions],
  );

  const handleInstall = useCallback(
    async (item: MarketplaceExtension) => {
      setInstallingId(item.id);
      const ok = await actions.install(item);
      setInstallingId(null);
      if (ok && item.required_secrets.length > 0) setSetupFor(item);
    },
    [actions],
  );

  const nothing = !loading && !error && data.installed.length === 0 && data.available.length === 0;

  return (
    <GKeyboardView>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {loading && data.installed.length === 0 && data.available.length === 0 ? (
          <InkSpinner label={t('extensions.loading')} />
        ) : null}

        {error ? (
          <View style={styles.notice}>
            <InkNotice tone="danger">{error}</InkNotice>
          </View>
        ) : null}

        {nothing ? (
          <InkEmptyState icon="package" title={t('extensions.noneTitle')}>
            <InkText>{t('extensions.noneBody')}</InkText>
          </InkEmptyState>
        ) : null}

        {data.installed.length > 0 ? (
          <View style={styles.section}>
            <InkTitle level={3}>{t('extensions.installedTitle')}</InkTitle>
            {data.installed.map((ext) => (
              <InstalledCard key={ext.name} extension={ext} onToggle={handleToggle} />
            ))}
          </View>
        ) : null}

        {setupFor ? (
          <SetupPrompt item={setupFor} onDone={() => setSetupFor(null)} />
        ) : null}

        {data.available.length > 0 ? (
          <View style={styles.section}>
            <InkTitle level={3}>{t('extensions.marketplaceTitle')}</InkTitle>
            {data.available.map((item) => (
              <MarketplaceCard
                key={item.id}
                item={item}
                installing={installingId === item.id}
                onInstall={handleInstall}
              />
            ))}
          </View>
        ) : null}

        <View style={{ height: 32 }} />
      </ScrollView>
    </GKeyboardView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },
  notice: { marginBottom: Spacing.md },
  section: { gap: Spacing.sm, marginBottom: Spacing.lg },

  /* Card */
  card: {
    backgroundColor: c.card,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: Spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: JaridaPurple[50],
    marginRight: Spacing.md,
  },
  cardInfo: { flex: 1 },
  cardName: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: c.text,
  },
  cardDesc: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: c.textTertiary,
    marginTop: 2,
  },

  /* Status */
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  errorText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    color: Semantic.danger,
    marginTop: Spacing.xs,
  },

  /* Category */
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
  },
  categoryBadge: {
    backgroundColor: c.backgroundSecondary,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radii.pill,
  },
  categoryText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: c.textSecondary,
  },

  /* Setup prompt */
  setupCard: {
    backgroundColor: c.backgroundSecondary,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    gap: Spacing.md,
  },
  setupTitle: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: c.text,
  },
  secretField: { gap: Spacing.xs },
  secretLabel: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: c.text,
  },
  secretDesc: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    color: c.textTertiary,
  },
  secretInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.card,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    gap: Spacing.sm,
  },
  secretInput: {
    flex: 1,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.sm,
    color: c.text,
  },
  secretSaveText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: c.textBrand,
  },
  secretSavedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  secretSavedText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Semantic.success,
  },
  oauthNotice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  oauthNoticeText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    color: c.textTertiary,
    flex: 1,
  },
});
