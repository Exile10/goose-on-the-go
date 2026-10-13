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
import { InkButton, InkEmptyState, InkNotice, InkSegmented, InkSpinner, InkSwitch, InkText, InkTitle } from '@jarida/ink/native';
import { Alert, View, Text, StyleSheet, ScrollView, TextInput } from 'react-native';

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
import type { Extension, MarketplaceExtension } from '@/services/types';
import { credentialFields, useExtensions } from '@/view-models/use-extensions';

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
  onCredentials,
  onRemove,
}: {
  extension: Extension;
  onToggle: (name: string, enabled: boolean) => void;
  /** Present when the marketplace entry it came from has credentials to set. */
  onCredentials?: (name: string) => void;
  /** Present only for a marketplace extension; the Pond's built-in ones stay. */
  onRemove?: (name: string) => void;
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

      {onCredentials || onRemove ? (
        <View style={styles.actionRow}>
          {onCredentials ? (
            <InkButton variant="quiet" icon="key" onPress={() => onCredentials(extension.name)}>
              {t('extensions.credentials')}
            </InkButton>
          ) : null}
          {onRemove ? (
            <InkButton variant="quiet" icon="trash" onPress={() => onRemove(extension.name)}>
              {t('common.remove')}
            </InkButton>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

type FormMode = 'install' | 'credentials';

/**
 * Every credential an extension asks for, sent with one submit. Write-only: nothing typed
 * here is read back, and what is left blank is not sent, so it keeps what the Pond holds.
 *
 * Installing, it comes first, since the Pond refuses an install that lacks a required
 * secret, and it is also the confirmation that the extension will run on the Pond.
 */
function CredentialsForm({
  item,
  mode,
  busy,
  onSubmit,
  onCancel,
}: {
  item: MarketplaceExtension;
  mode: FormMode;
  busy: boolean;
  onSubmit: (secrets: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});
  const fields = credentialFields(item);

  const filled: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value.trim()) filled[key] = value.trim();
  }
  // An install needs every required field now; a save needs something to save.
  const ready = mode === 'install'
    ? fields.every((f) => !f.required || filled[f.key])
    : Object.keys(filled).length > 0;
  const setValue = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));

  return (
    <View style={styles.setupCard}>
      <Text style={styles.setupTitle}>{t('extensions.setupTitle', { name: item.name })}</Text>
      <Text style={styles.secretDesc}>
        {mode === 'install'
          ? t('extensions.installConfirmBody', { name: item.name })
          : t('extensions.credentialsBody')}
      </Text>
      {fields.map((req) => {
        const chosen = req.options?.find((o) => o.value === values[req.key]);
        return (
          <View key={req.key} style={styles.secretField}>
            <View style={styles.labelRow}>
              <Text style={styles.secretLabel}>{req.display_name}</Text>
              {req.required ? <Text style={styles.secretDesc}>{t('extensions.required')}</Text> : null}
            </View>
            {req.description ? <Text style={styles.secretDesc}>{req.description}</Text> : null}
            {req.kind === 'choice' ? (
              // A choice is not a secret: its answers are shown, never typed or masked.
              <InkSegmented
                label={req.display_name}
                value={values[req.key] ?? ''}
                options={(req.options ?? []).map((o) => ({ value: o.value, label: o.label, disabled: busy }))}
                onChange={(next) => setValue(req.key, next)}
              />
            ) : (
              <View style={styles.secretInputRow}>
                <TextInput
                  style={styles.secretInput}
                  value={values[req.key] ?? ''}
                  onChangeText={(next) => setValue(req.key, next)}
                  secureTextEntry
                  editable={!busy}
                  accessibilityLabel={req.display_name}
                  placeholder={t('extensions.secretPlaceholder')}
                  placeholderTextColor={Grey[400]}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            )}
            {chosen?.description ? <Text style={styles.secretDesc}>{chosen.description}</Text> : null}
          </View>
        );
      })}
      <View style={styles.formActions}>
        <InkButton variant="quiet" onPress={onCancel} disabled={busy}>{t('common.cancel')}</InkButton>
        <InkButton variant="primary" onPress={() => onSubmit(filled)} disabled={busy || !ready}>
          {mode === 'install'
            ? busy ? t('extensions.installing') : t('extensions.install')
            : busy ? t('extensions.saving') : t('common.save')}
        </InkButton>
      </View>
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
  const { data, loading, error, failed, actions } = useExtensions();
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [form, setForm] = useState<{ item: MarketplaceExtension; mode: FormMode } | null>(null);
  const [saving, setSaving] = useState(false);

  const handleToggle = useCallback(
    (name: string, enabled: boolean) => void actions.setEnabled(name, enabled),
    [actions],
  );

  const runInstall = useCallback(
    async (item: MarketplaceExtension, secrets?: Record<string, string>) => {
      setInstallingId(item.id);
      const ok = await actions.install(item, secrets);
      setInstallingId(null);
      return ok;
    },
    [actions],
  );

  /**
   * An extension runs as a program on the Pond's computer -- Filesystem is handed `/` --
   * so an install is confirmed first. One with credentials is confirmed by its form.
   */
  const handleInstall = useCallback(
    (item: MarketplaceExtension) => {
      if (credentialFields(item).length > 0) {
        setForm({ item, mode: 'install' });
        return;
      }
      Alert.alert(
        t('extensions.installConfirmTitle', { name: item.name }),
        t('extensions.installConfirmBody', { name: item.name }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('extensions.install'), onPress: () => void runInstall(item) },
        ],
      );
    },
    [runInstall, t],
  );

  const handleCredentials = useCallback(
    (name: string) => {
      const item = data.marketplace.find((m) => m.id === name);
      if (item) setForm({ item, mode: 'credentials' });
    },
    [data.marketplace],
  );

  const confirmRemove = useCallback(
    (name: string) => {
      const label = data.marketplace.find((m) => m.id === name)?.name ?? name;
      Alert.alert(
        t('extensions.removeConfirmTitle', { name: label }),
        t('extensions.removeConfirmBody', { name: label }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('common.remove'), style: 'destructive', onPress: () => void actions.remove(name) },
        ],
      );
    },
    [actions, data.marketplace, t],
  );

  /** Closes the form only on success, so a refused submit keeps what was typed. */
  const handleSubmit = useCallback(
    async (secrets: Record<string, string>) => {
      if (!form) return;
      let ok: boolean;
      if (form.mode === 'install') {
        ok = await runInstall(form.item, Object.keys(secrets).length > 0 ? secrets : undefined);
      } else {
        setSaving(true);
        ok = await actions.saveSecrets(form.item.id, secrets);
        setSaving(false);
      }
      if (ok) setForm(null);
    },
    [actions, form, runInstall],
  );

  // A first read that failed is not an empty Pond: say so, and offer the read again.
  const nothing = !loading && !error && !failed && data.installed.length === 0 && data.available.length === 0;

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

        {failed && !error && !loading ? (
          <View style={styles.notice}>
            <InkNotice tone="danger">{t('extensions.loadFailed')}</InkNotice>
            <GPressable onPress={() => void actions.refresh()} hitSlop={8}>
              <InkText>{t('common.retry')}</InkText>
            </GPressable>
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
            {data.installed.map((ext) => {
              // Only a marketplace install is named by a marketplace id. The Pond's built-in
              // `giap-*` extensions never are, so they get neither credentials nor Remove.
              const item = data.marketplace.find((m) => m.id === ext.name);
              return (
                <React.Fragment key={ext.name}>
                  <InstalledCard
                    extension={ext}
                    onToggle={handleToggle}
                    onCredentials={item && credentialFields(item).length > 0 ? handleCredentials : undefined}
                    onRemove={item ? confirmRemove : undefined}
                  />
                  {form?.mode === 'credentials' && form.item.id === ext.name ? (
                    <CredentialsForm
                      item={form.item}
                      mode="credentials"
                      busy={saving}
                      onSubmit={handleSubmit}
                      onCancel={() => setForm(null)}
                    />
                  ) : null}
                </React.Fragment>
              );
            })}
          </View>
        ) : null}

        {data.available.length > 0 ? (
          <View style={styles.section}>
            <InkTitle level={3}>{t('extensions.marketplaceTitle')}</InkTitle>
            {data.available.map((item) => (
              <React.Fragment key={item.id}>
                <MarketplaceCard
                  item={item}
                  installing={installingId === item.id}
                  onInstall={handleInstall}
                />
                {form?.mode === 'install' && form.item.id === item.id ? (
                  <CredentialsForm
                    item={item}
                    mode="install"
                    busy={installingId === item.id}
                    onSubmit={handleSubmit}
                    onCancel={() => setForm(null)}
                  />
                ) : null}
              </React.Fragment>
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
  notice: { marginBottom: Spacing.md, gap: Spacing.sm },
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
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.md,
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

  /* Credentials form */
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
  labelRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm },
});
