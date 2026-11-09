/**
 * Where an answer or a report came from, kept small: each cited page is a numbered chip in the
 * text, the pages sit folded in one "N sources" chip that opens into numbered chips, and a chip
 * opens a card with the page's title and site before the page itself. Under them, the pictures
 * the Pond kept for those pages, credited, which the phone loads from the Pond, never the site.
 */

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import { InkChip, InkText } from '@jarida/ink/native';

import type { SourceChips } from '@/components/patterns/markdown';
import { PondPicture } from '@/components/patterns/pond-picture';
import { Spacing } from '@/constants/spacing';
import { siteOf, type ReportImage } from '@/models/web-watches';
import { useConfirm } from '@/providers/confirm-provider';
import { selectionTick } from '@/services/haptics';

export interface CitedSource {
  title: string;
  url: string;
}

const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** The web pages a text links to, in the order first cited, once each. */
export function citedLinks(markdown: string): CitedSource[] {
  const out: CitedSource[] = [];
  for (const m of markdown.matchAll(LINK)) {
    const url = m[2];
    if (!out.some((s) => s.url === url)) out.push({ title: m[1].trim() || siteOf(url), url });
  }
  return out;
}

/** The cited pages first, in citing order, then the other pages read; each once. */
export function mergeSources(cited: CitedSource[], read: CitedSource[]): CitedSource[] {
  const out = [...cited];
  for (const s of read) if (!out.some((o) => o.url === s.url)) out.push(s);
  return out;
}

/** The chips' numbering and what a tap does: a card naming the page, then the page. */
export function useSourceChips(sources: CitedSource[]): SourceChips | undefined {
  const ask = useConfirm();
  const { t } = useTranslation();
  return useMemo(() => {
    if (sources.length === 0) return undefined;
    return {
      numberOf: (url) => {
        const i = sources.findIndex((s) => s.url === url);
        return i === -1 ? undefined : i + 1;
      },
      open: (url) => {
        const source = sources.find((s) => s.url === url);
        void selectionTick();
        void ask({
          title: source?.title ?? siteOf(url),
          message: `${siteOf(url)}\n${url}`,
          confirmLabel: t('chat.report.openSource'),
        }).then((yes) => {
          if (yes) void WebBrowser.openBrowserAsync(url);
        });
      },
    };
  }, [ask, sources, t]);
}

/** The pages folded into one chip, which opens into a numbered chip for each. */
export function SourcesChipRow({ sources, chips }: { sources: CitedSource[]; chips: SourceChips | undefined }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (sources.length === 0 || !chips) return null;
  return (
    <View style={styles.row}>
      <InkChip icon="link" selected={open} onPress={() => setOpen((o) => !o)}>
        {t('chat.report.sourcesCount', { count: sources.length })}
      </InkChip>
      {open
        ? sources.map((source, i) => (
            <InkChip key={source.url} onPress={() => chips.open(source.url)}>
              {`${i + 1}  ${source.title.length > 40 ? `${source.title.slice(0, 39)}…` : source.title}`}
            </InkChip>
          ))
        : null}
    </View>
  );
}

/** The Pond's pictures for the pages, each with its credit under it. */
export function PagePictures({ pictures }: { pictures: ReportImage[] }) {
  if (pictures.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pictures}>
      {pictures.map((image) => (
        <View key={image.key} style={styles.picture}>
          <PondPicture path={image.src} label={image.caption ?? image.credit} style={styles.pictureBox} />
          <InkText size="xs" tone="tertiary" numberOfLines={2}>
            {image.credit}
          </InkText>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  pictures: { gap: Spacing.md },
  picture: { width: 240, gap: Spacing.xs },
  pictureBox: { width: 240, height: 160, borderRadius: 12, overflow: 'hidden' },
});
