/**
 * Finding a model on Hugging Face, through the Pond, and downloading one of its files to the Pond.
 */

import React from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InkNotice, InkSpinner } from '@jarida/ink/native';

import { SettingsGroup, SettingsHeader, SettingsMessage, SettingsRow } from '@/components/settings/settings-list';
import {
  useSettingsColors,
  useSettingsStyles,
  type SettingsColors,
  type SettingsMetrics,
  type SettingsType,
} from '@/components/settings/settings-theme';
import { GIcon } from '@/components/ui/g-icon';
import { GKeyboardView } from '@/components/ui/g-keyboard-view';
import { Spacing } from '@/constants/spacing';
import { formatBytes, formatMegabytes } from '@/models/model-library';
import { confirm, selectionTick, tap } from '@/services/haptics';
import type { HfModelFile } from '@/services/types';
import { useModelLibrary, useModelSearch } from '@/view-models/use-model-library';

export default function ModelSearchScreen() {
  const { t } = useTranslation();
  const colors = useSettingsColors();
  const styles = useSettingsStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const lib = useModelLibrary();
  const search = useModelSearch();
  const [started, setStarted] = React.useState<string | null>(null);

  const picturesNote = (file: HfModelFile) => {
    if (!file.pictures) return null;
    const size = formatBytes(file.pictures.size_bytes);
    return size ? t('models.library.filePicturesSize', { size }) : t('models.library.filePictures');
  };

  const askFile = (file: HfModelFile) => {
    void tap();
    const size = formatMegabytes(file.size_mb);
    const start = (pictures: boolean) =>
      void lib.actions.downloadFile(file, pictures).then((ok) => {
        if (!ok) return;
        void confirm();
        setStarted(file.filename);
      });
    const options = file.pictures
      ? [
          { text: t('models.library.withPictures'), onPress: () => start(true) },
          { text: t('models.library.textOnly'), onPress: () => start(false) },
        ]
      : [{ text: t('models.library.download'), onPress: () => start(false) }];
    Alert.alert(
      t('models.library.downloadTitle', { name: file.filename }),
      size ? t('models.library.downloadBody', { size }) : t('models.library.downloadBodyNoSize'),
      [{ text: t('common.cancel'), style: 'cancel' }, ...options],
    );
  };

  return (
    <GKeyboardView style={{ flex: 1, backgroundColor: colors.page }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: insets.bottom + Spacing['4xl'] }}
      >
        <SettingsHeader icon="search" tile="blue" title={t('models.library.search')} description={t('models.library.footer.search')} />
        <View style={styles.search}>
          <GIcon name="search" size={18} color={colors.textTertiary} />
          <TextInput
            value={search.query}
            onChangeText={search.actions.setQuery}
            onSubmitEditing={() => void search.actions.search()}
            placeholder={t('models.library.searchPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel={t('models.library.search')}
            style={styles.input}
          />
          <Pressable onPress={() => void search.actions.search()} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.searchButton}>{t('models.library.searchButton')}</Text>
          </Pressable>
        </View>

        {started ? <InkNotice tone="success">{t('models.library.started')}</InkNotice> : null}
        {lib.notice ? <InkNotice tone="danger">{lib.notice.text}</InkNotice> : null}
        {search.searching ? <InkSpinner label={t('models.library.searchButton')} /> : null}
        {search.error ? <SettingsMessage tone="danger">{search.error}</SettingsMessage> : null}

        {search.files ? (
          <SettingsGroup title={search.files.repo}>
            <SettingsRow label={t('common.back')} icon="chevron-left" tile="slate" onPress={() => { void selectionTick(); search.actions.closeRepo(); }} />
            {search.files.loading ? <SettingsRow label={t('settings.loading')} /> : null}
            {search.files.error ? <SettingsRow label={search.files.error} /> : null}
            {!search.files.loading && !search.files.error && search.files.items.length === 0 ? <SettingsRow label={t('models.library.noFiles')} /> : null}
            {search.files.items.map((file) => (
              <SettingsRow
                key={file.filename}
                label={file.filename}
                description={[formatMegabytes(file.size_mb), picturesNote(file)].filter(Boolean).join(' · ') || null}
                trailing={<GIcon name="download" size={18} color={colors.accent} />}
                onPress={() => askFile(file)}
              />
            ))}
          </SettingsGroup>
        ) : search.results.length > 0 ? (
          <SettingsGroup>
            {search.results.map((repo) => (
              <SettingsRow
                key={repo.id}
                label={repo.id}
                description={t('models.library.stats', { downloads: repo.downloads.toLocaleString(), likes: repo.likes.toLocaleString() })}
                accessory="next"
                onPress={() => {
                  void selectionTick();
                  void search.actions.openRepo(repo.id);
                }}
              />
            ))}
          </SettingsGroup>
        ) : !search.searching && search.query && !search.error ? null : null}
      </ScrollView>
    </GKeyboardView>
  );
}

const makeStyles = (c: SettingsColors, type: SettingsType, m: SettingsMetrics) => ({
  search: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Spacing.sm,
    backgroundColor: c.group,
    borderRadius: m.radius.md,
    borderWidth: m.hairline,
    borderColor: c.edge,
    paddingHorizontal: Spacing.md,
    minHeight: 48,
    marginBottom: Spacing.lg,
  },
  input: { ...type.body, flex: 1, paddingVertical: Spacing.sm },
  searchButton: { ...type.label, color: c.accent },
});
