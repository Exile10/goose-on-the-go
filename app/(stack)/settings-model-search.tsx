/**
 * Finding a model on Hugging Face, through the Pond, and downloading one of its files to the Pond.
 */

import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkSpinner } from '@jarida/ink/native';

import { SettingsGroup, SettingsHeader, SettingsMessage, SettingsRow } from '@/components/settings/settings-list';
import { SettingsScroll } from '@/components/settings/settings-scroll';
import {
  useSettingsColors,
  useSettingsStyles,
  type SettingsColors,
  type SettingsMetrics,
  type SettingsType,
} from '@/components/settings/settings-theme';
import { GIcon } from '@/components/ui/g-icon';
import { Spacing } from '@/constants/spacing';
import { formatBytes, formatMegabytes } from '@/models/model-library';
import { useChoice } from '@/providers/confirm-provider';
import { useSnackbar } from '@/providers/snackbar-provider';
import { confirm, selectionTick, tap } from '@/services/haptics';
import type { HfModelFile } from '@/services/types';
import { useModelLibrary, useModelSearch } from '@/view-models/use-model-library';

export default function ModelSearchScreen() {
  const { t } = useTranslation();
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  const choose = useChoice();
  const lib = useModelLibrary();
  const search = useModelSearch();
  const snackbar = useSnackbar();

  const picturesNote = (file: HfModelFile) => {
    if (!file.pictures) return null;
    const size = formatBytes(file.pictures.size_bytes);
    return size ? t('models.library.filePicturesSize', { size }) : t('models.library.filePictures');
  };

  const askFile = async (file: HfModelFile) => {
    void tap();
    const size = formatMegabytes(file.size_mb);
    const options = file.pictures
      ? [
          { label: t('models.library.withPictures'), value: true },
          { label: t('models.library.textOnly'), value: false },
        ]
      : [{ label: t('models.library.download'), value: false }];
    const pictures = await choose({
      title: t('models.library.downloadTitle', { name: file.filename }),
      message: size ? t('models.library.downloadBody', { size }) : t('models.library.downloadBodyNoSize'),
      options,
    });
    if (pictures === null) return;
    if (!(await lib.actions.downloadFile(file, pictures))) return;
    void confirm();
    snackbar.show({ message: t('models.library.started') });
  };

  return (
    <SettingsScroll typing>
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
              onPress={() => void askFile(file)}
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
    </SettingsScroll>
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
