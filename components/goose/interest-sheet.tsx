/**
 * Adding or editing an interest: the topic, its kind, the particular angles (the teams, people or
 * shows within it), how much the member cares, and whether and how it feeds the news.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkInput, InkSegmented, InkSelect, InkSheet } from '@/components/ui/ink';

import { Spacing } from '@/constants/spacing';
import { CATEGORIES, DEPTHS, NEWS_CHOICES, categoryKey, depthKey, newsKey, type Interest, type InterestCategory, type InterestDepth, type InterestNews } from '@/models/interests';
import type { InterestEdit } from '@/view-models/use-interests';
import { Labelled } from './labelled';

export function InterestSheet({
  open,
  interest,
  onClose,
  onSave,
}: {
  open: boolean;
  /** Null to add one. */
  interest: Interest | null;
  onClose: () => void;
  onSave: (edit: InterestEdit & { topic: string }) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  return (
    <InkSheet open={open} onClose={onClose} title={interest ? t('goose.interests.editTitle', { topic: interest.topic }) : t('goose.interests.addTitle')}>
      {/* Keyed so each opening starts from the interest as it is now. */}
      {open ? <InterestForm key={interest?.id ?? 'new'} interest={interest} onClose={onClose} onSave={onSave} /> : null}
    </InkSheet>
  );
}

function InterestForm({ interest, onClose, onSave }: { interest: Interest | null; onClose: () => void; onSave: (edit: InterestEdit & { topic: string }) => Promise<unknown> }) {
  const { t } = useTranslation();
  const [topic, setTopic] = useState(interest?.topic ?? '');
  const [category, setCategory] = useState<InterestCategory>(interest?.category ?? 'other');
  const [facets, setFacets] = useState(interest?.facets.join(', ') ?? '');
  const [depth, setDepth] = useState<InterestDepth>(interest?.depth ?? 'keen');
  const [news, setNews] = useState<InterestNews>(interest?.news ?? 'tiles');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const done = await onSave({ topic: topic.trim(), category, facets: facets.split(',').map((f) => f.trim()).filter(Boolean), depth, news });
    setSaving(false);
    if (done) onClose();
  };

  return (
    <View style={styles.form}>
      <Labelled label={t('goose.interests.topic')}>
        <InkInput label={t('goose.interests.topic')} value={topic} onChange={setTopic} placeholder={t('goose.interests.topicPlaceholder')} />
      </Labelled>
      <Labelled label={t('goose.interests.kind')}>
        <InkSelect label={t('goose.interests.kind')} value={category} options={CATEGORIES.map((c) => ({ value: c, label: t(categoryKey(c)) }))} onChange={(v) => setCategory(v as InterestCategory)} />
      </Labelled>
      <Labelled label={t('goose.interests.facets')} hint={t('goose.interests.facetsHint')}>
        <InkInput label={t('goose.interests.facets')} value={facets} onChange={setFacets} placeholder={t('goose.interests.facetsPlaceholder')} />
      </Labelled>
      <InkSegmented label={t('goose.interests.depthLabel')} value={depth} options={DEPTHS.map((d) => ({ value: d, label: t(depthKey(d)) }))} onChange={setDepth} />
      <InkSegmented label={t('goose.interests.newsLabel')} value={news} options={NEWS_CHOICES.map((n) => ({ value: n, label: t(newsKey(n)) }))} onChange={setNews} />
      <InkButton variant="primary" block loading={saving} disabled={!topic.trim()} onPress={() => void save()}>
        {interest ? t('goose.interests.save') : t('goose.interests.add')}
      </InkButton>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.lg },
});
