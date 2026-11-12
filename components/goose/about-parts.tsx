/**
 * What the profile, the set-aside list, Goose's notes and the screenshot notes share: a section of
 * compact rows whose sentence wraps, and the sheet that adds or rewords a fact.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkChip, InkNotice, InkSheet, InkText, InkTextArea, useInkTheme } from '@jarida/ink/native';

import { DangerQuietButton } from '@/components/pond/danger-quiet-button';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import type { IconName } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import { wordLabel, type AboutFact, type AboutWord } from '@/models/about';
import { useConfirm } from '@/providers/confirm-provider';
import { selectionTick } from '@/services/haptics';
import { SectionHead } from './hub-parts';
import { Labelled } from './labelled';

/** A small heading over its rows. */
export function ListSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <SectionHead title={title} size="small" />
      {children}
    </View>
  );
}

/**
 * One row of an inset group: a sentence that wraps rather than being cut, at most one quiet line
 * under it, a glyph before it where a list reads better with one, and a control or a chevron at its end.
 */
export function SentenceRow({
  icon,
  text,
  detail,
  detailLines = 1,
  first,
  onPress,
  label,
  trailing,
}: {
  icon?: IconName;
  text: string;
  detail?: string | null;
  detailLines?: number;
  first?: boolean;
  onPress?: () => void;
  /** What a screen reader says for a row that opens something. */
  label?: string;
  trailing?: React.ReactNode;
}) {
  const theme = useInkTheme();
  const row = (
    <View style={styles.row}>
      {icon ? <GIcon name={icon} size={20} color={theme.color.accentLine} /> : null}
      <View style={[styles.rowBody, first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.line }]}>
        <View style={styles.rowWords}>
          <InkText size="md">{text}</InkText>
          {detail ? (
            <InkText size="sm" tone="secondary" numberOfLines={detailLines}>
              {detail}
            </InkText>
          ) : null}
        </View>
        {trailing ?? (onPress ? <GIcon name="chevron-right" size={18} color={theme.color.textTertiary} /> : null)}
      </View>
    </View>
  );
  if (!onPress) return row;
  return (
    <GPressable
      onPress={() => {
        void selectionTick();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label ?? text}
    >
      {row}
    </GPressable>
  );
}

/** "14 Nov", with the year once it is not this one. */
export function shortDate(iso: string, language: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(language, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** The picker's words under the headings the profile files them by, in the Pond's order. */
function wordsByHeading(words: AboutWord[]): { heading: string; words: AboutWord[] }[] {
  const groups: { heading: string; words: AboutWord[] }[] = [];
  for (const word of words) {
    const group = groups.find((g) => g.heading === word.heading);
    if (group) group.words.push(word);
    else groups.push({ heading: word.heading, words: [word] });
  }
  return groups;
}

function WordPicker({ words, value, onChange }: { words: AboutWord[]; value: string | null; onChange: (about: string) => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.picker} accessibilityRole="radiogroup" accessibilityLabel={t('goose.about.wordLabel')}>
      <InkText size="sm" weight="semibold">
        {t('goose.about.wordLabel')}
      </InkText>
      {wordsByHeading(words).map((group) => (
        <View key={group.heading} style={styles.wordGroup}>
          <InkText size="sm" tone="secondary">
            {group.heading || t('goose.about.other')}
          </InkText>
          <View style={styles.chips}>
            {group.words.map((word) => (
              <InkChip
                key={word.about}
                tone="brand"
                selected={value === word.about}
                onPress={() => {
                  void selectionTick();
                  onChange(word.about);
                }}
              >
                {wordLabel(word.about)}
              </InkChip>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export interface FactSheetProps {
  open: boolean;
  /** The fact being reworded, or null to add one. */
  fact: AboutFact | null;
  /** Changes with each opening, so the form starts from the fact as it is now. */
  opening: number;
  words: AboutWord[];
  onClose: () => void;
  /** Each resolves with why the Pond refused, or null once it is done. */
  onAdd: (content: string, about: string) => Promise<string | null>;
  onEdit: (fact: AboutFact, change: { content: string; about: string | null }) => Promise<string | null>;
  onDelete: (fact: AboutFact) => Promise<string | null>;
}

/** Add a fact, or reword one, file it under another word, or delete it. */
export function FactSheet({ open, fact, opening, ...form }: FactSheetProps) {
  const { t } = useTranslation();
  return (
    <InkSheet open={open} onClose={form.onClose} title={fact ? t('goose.about.editTitle') : t('goose.about.addTitle')}>
      <FactForm key={opening} fact={fact} {...form} />
    </InkSheet>
  );
}

function FactForm({ fact, words, onClose, onAdd, onEdit, onDelete }: Omit<FactSheetProps, 'open' | 'opening'>) {
  const { t } = useTranslation();
  const ask = useConfirm();
  const [content, setContent] = useState(fact?.content ?? '');
  const [about, setAbout] = useState<string | null>(fact?.about ?? null);
  const [working, setWorking] = useState<'save' | 'delete' | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const word = words.find((w) => w.about === about);
  // An older fact not yet filed may be reworded as it is; a new one needs its word.
  const ready = content.trim().length > 0 && (fact !== null || about !== null);

  // The snackbar draws under a sheet, so a refusal is said here, beside what was typed.
  const settle = async (kind: 'save' | 'delete', send: () => Promise<string | null>) => {
    setWorking(kind);
    setRefused(null);
    const why = await send();
    setWorking(null);
    if (why) setRefused(why);
    else onClose();
  };

  const save = () => {
    if (!ready || working) return;
    void settle('save', () => (fact ? onEdit(fact, { content, about }) : onAdd(content, about ?? '')));
  };

  const remove = async () => {
    if (!fact || working) return;
    const yes = await ask({
      title: t('goose.about.deleteConfirmTitle'),
      message: t('goose.about.deleteConfirmBody'),
      confirmLabel: t('goose.about.delete'),
      destructive: true,
    });
    if (yes) await settle('delete', () => onDelete(fact));
  };

  return (
    <View style={styles.form}>
      <Labelled label={t('goose.about.contentLabel')}>
        <InkTextArea label={t('goose.about.contentLabel')} value={content} onChange={setContent} placeholder={t('goose.about.contentPlaceholder')} rows={2} maxRows={5} />
      </Labelled>
      <WordPicker words={words} value={about} onChange={setAbout} />
      {/* Only adding closes the old one; filing an existing fact under the word does not. */}
      {!fact && word?.oneAtATime ? (
        <InkText size="sm" tone="secondary">
          {t('goose.about.replaces')}
        </InkText>
      ) : null}
      {refused ? <InkNotice tone="danger">{refused}</InkNotice> : null}
      <InkButton variant="primary" block loading={working === 'save'} disabled={!ready || working === 'delete'} onPress={save}>
        {working === 'save' ? t('goose.about.saving') : t('goose.about.save')}
      </InkButton>
      {fact ? (
        <DangerQuietButton icon="trash" disabled={working !== null} onPress={() => void remove()}>
          {t('goose.about.delete')}
        </DangerQuietButton>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingLeft: Spacing.md },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 48, paddingVertical: Spacing.sm, paddingRight: Spacing.md },
  rowWords: { flex: 1, gap: 2 },
  form: { gap: Spacing.lg },
  picker: { gap: Spacing.sm },
  wordGroup: { gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
});
