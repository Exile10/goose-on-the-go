/**
 * ModelsScreen — the models this Pond has, and which of them are serving.
 *
 * Grouped by the category the server files each model under, because that is
 * also what a role is scoped to: a Pond serves a language model, a voice and an
 * embedder at the same time, so "active" is a list rather than one row.
 *
 * Every fact on a card comes from the catalogue row. The cards once showed
 * invented Speed/Quality/Privacy ratings and a cloud-versus-local badge; the
 * API produces neither, and every category it returns runs on the Pond anyway.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';

import { GPressable } from '@/components/ui/g-pressable';
import { useTranslation } from 'react-i18next';
import {
  InkBadge,
  InkCard,
  InkGroup,
  InkRow,
  InkEmptyState,
  InkNotice,
  InkSpinner,
  InkText,
  InkTitle,
} from '@jarida/ink/native';

import { formatContextWindow, formatSize, useModels } from '@/view-models/use-models';
import { selectionTick, confirm } from '@/services/haptics';
import type { ModelCategory, ModelEntry } from '@/services/types';
import type { TranslationKey } from '@/services/i18n';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';

/** One literal key per category, so the key-completeness test can see every one. */
function categoryKey(category: ModelCategory): TranslationKey {
  switch (category) {
    case 'gguf': return 'models.category.gguf';
    case 'ollama': return 'models.category.ollama';
    case 'llamafile': return 'models.category.llamafile';
    case 'whisper': return 'models.category.whisper';
    case 'tts': return 'models.category.tts';
    case 'embedding': return 'models.category.embedding';
  }
}

/** One reported fact about a model. Rendered only when the server sent it. */
function Fact({ label, value }: { label: string; value: string | null }) {
  const styles = useThemedStyles(makeStyles);
  if (!value) return null;
  return (
    <View style={styles.factRow}>
      <InkText>{label}</InkText>
      <InkText>{value}</InkText>
    </View>
  );
}

const ModelCard = React.memo(function ModelCard({
  model,
  onSelect,
}: {
  model: ModelEntry;
  onSelect: (model: ModelEntry) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const missing = model.downloaded === false;

  const handlePress = useCallback(() => {
    if (missing) return;
    void confirm();
    onSelect(model);
  }, [missing, model, onSelect]);

  return (
    <GPressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={{ selected: model.active, disabled: missing }}
      // A model that is not on disk cannot be activated from here; downloading
      // one is the Pond's own job, not the phone's.
      disabled={missing}
      style={missing ? styles.cardMuted : undefined}
    >
      <InkCard style={styles.card}>
        <View style={styles.cardHead}>
          <InkTitle level={3}>{model.name}</InkTitle>
          {model.active ? <InkBadge tone="success">{t('models.active')}</InkBadge> : null}
        </View>

        {model.description ? <InkText>{model.description}</InkText> : null}

        <View style={styles.facts}>
          <Fact label={t('models.context')} value={formatContextWindow(model.context_length)} />
          <Fact label={t('models.size')} value={formatSize(model.size_mb)} />
          <Fact
            label={t('models.memory')}
            value={
              model.ram_estimate_mb
                ? t('models.memoryValue', { size: formatSize(model.ram_estimate_mb) })
                : null
            }
          />
          <Fact label={t('models.role')} value={model.recommended_role ?? null} />
        </View>

        {missing ? <InkText>{t('models.notDownloaded')}</InkText> : null}
      </InkCard>
    </GPressable>
  );
});

export default function ModelsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { data, loading, error, actions } = useModels();

  const handleRetry = useCallback(() => {
    void selectionTick();
    void actions.refresh();
  }, [actions]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {/* What is serving right now, before the catalogue of what could.
          Named by the role each one fills, since a Pond runs several at once. */}
      {data.active.length > 0 ? (
        <InkGroup title={t('models.serving')} style={styles.serving}>
          {data.active.map((m, i) => (
            <InkRow key={m.id} divided={i > 0} label={t(categoryKey(m.category))}>
              <InkText>{m.name}</InkText>
            </InkRow>
          ))}
        </InkGroup>
      ) : (
        <View style={styles.serving}>
          <InkTitle level={3}>{t('models.serving')}</InkTitle>
          <InkText>{t('models.noneActive')}</InkText>
        </View>
      )}

      {loading ? <InkSpinner label={t('pond.checking')} /> : null}

      {error ? (
        <View style={styles.stateBlock}>
          <InkNotice tone="danger">{error}</InkNotice>
          <GPressable onPress={handleRetry} hitSlop={8}>
            <InkText>{t('common.retry')}</InkText>
          </GPressable>
        </View>
      ) : null}

      {!loading && !error && data.models.length === 0 ? (
        <InkEmptyState icon="models" title={t('models.empty')}>
          <InkText>{t('models.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}

      {data.groups.map((group) => (
        <View key={group.category} style={styles.group}>
          <InkTitle level={3}>{t(categoryKey(group.category))}</InkTitle>
          {group.models.map((m) => (
            <ModelCard key={m.id} model={m} onSelect={actions.activate} />
          ))}
        </View>
      ))}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },

    serving: { marginBottom: Spacing.xl, gap: Spacing.sm },

    group: { marginBottom: Spacing.xl, gap: Spacing.md },

    card: { gap: Spacing.sm },
    cardMuted: { opacity: 0.55 },
    cardHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.sm,
    },

    facts: { gap: 2 },
    factRow: { flexDirection: 'row', justifyContent: 'space-between' },

    stateBlock: { gap: Spacing.sm, marginBottom: Spacing.lg },
  });
