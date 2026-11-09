/**
 * Where an answer or a report came from, kept small: each cited page is a numbered chip in the
 * text, the pages sit folded in one "N sources" chip that opens into numbered chips, and a chip
 * opens a card in place with the page's title, site and picture and a way to the page. Under them,
 * the pictures the Pond kept for those pages, each in its own shape and credited, which the phone
 * loads from the Pond, never the site.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkChip, InkText } from '@/components/ui/ink';

import type { SourceChips } from '@/components/patterns/markdown';
import { PondPicture, usePictureRatio } from '@/components/patterns/pond-picture';
import { Spacing } from '@/constants/spacing';
import type { CitedSource } from '@/models/sources';
import { siteOf, type ReportImage } from '@/models/web-watches';
import { selectionTick } from '@/services/haptics';

/** The chips' numbering, and which page's card is open: a chip in the text opens the same card. */
export interface SourcesState {
  sources: CitedSource[];
  chips: SourceChips | undefined;
  open: boolean;
  toggleOpen: () => void;
  selected: string | null;
  close: () => void;
}

export function useSources(sources: CitedSource[]): SourcesState {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const chips = useMemo<SourceChips | undefined>(() => {
    if (sources.length === 0) return undefined;
    return {
      numberOf: (url) => {
        const i = sources.findIndex((s) => s.url === url);
        return i === -1 ? undefined : i + 1;
      },
      open: (url) => {
        void selectionTick();
        setOpen(true);
        setSelected((current) => (current === url ? null : url));
      },
    };
  }, [sources]);
  // One page needs no choosing: opening the chip opens its card.
  const only = sources.length === 1 ? sources[0].url : null;
  const toggleOpen = useCallback(() => {
    void selectionTick();
    setOpen((o) => {
      setSelected(o ? null : only);
      return !o;
    });
  }, [only]);
  const close = useCallback(() => setSelected(null), []);
  return { sources, chips, open, toggleOpen, selected, close };
}

/** The pages folded into one chip; open, a numbered chip for each and the chosen page's card. */
export function SourcesChipRow({ state, pictures = [] }: { state: SourcesState; pictures?: ReportImage[] }) {
  const { t } = useTranslation();
  const { sources, chips, open, toggleOpen, selected, close } = state;
  if (sources.length === 0 || !chips) return null;
  const chosen = sources.find((s) => s.url === selected) ?? null;
  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <InkChip icon="link" selected={open} onPress={toggleOpen}>
          {t('chat.report.sourcesCount', { count: sources.length })}
        </InkChip>
        {open
          ? sources.map((source, i) => (
              <InkChip key={source.url} selected={source.url === selected} onPress={() => chips.open(source.url)}>
                {`${i + 1}  ${source.title.length > 40 ? `${source.title.slice(0, 39)}…` : source.title}`}
              </InkChip>
            ))
          : null}
      </View>
      {chosen ? (
        <SourceCard
          source={chosen}
          picture={pictures.find((p) => p.page === chosen.url) ?? null}
          onClose={close}
        />
      ) : null}
    </View>
  );
}

/** One page, opened from its chip: what it is and where, its picture, and the way to it. */
function SourceCard({
  source,
  picture,
  onClose,
}: {
  source: CitedSource;
  picture: ReportImage | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const path = source.url.replace(/^https?:\/\/[^/]+/i, '') || '/';
  return (
    <InkCard>
      <View style={styles.cardHead}>
        <View style={styles.cardText}>
          <InkText weight="semibold" numberOfLines={2}>{source.title}</InkText>
          <InkText size="sm" tone="secondary" numberOfLines={1}>{siteOf(source.url)}</InkText>
          <InkText size="xs" tone="tertiary" numberOfLines={1}>{path}</InkText>
        </View>
        {picture ? <PondPicture path={picture.src} label={picture.caption ?? picture.credit} style={styles.thumb} /> : null}
      </View>
      <View style={styles.cardActions}>
        <InkButton icon="external" onPress={() => void WebBrowser.openBrowserAsync(source.url)}>
          {t('chat.report.openSource')}
        </InkButton>
        <InkButton variant="quiet" icon="x" onPress={onClose}>
          {t('chat.report.closeSource')}
        </InkButton>
      </View>
    </InkCard>
  );
}

/** Frame width for a picture; one alone takes more of the line than several side by side. */
const ONE_WIDTH = 300;
const SOME_WIDTH = 240;
/** A very tall picture is held to this and shown whole inside it rather than cut. */
const MAX_HEIGHT = 360;

/** A picture framed in its own shape once its size is known, so nothing of it is cut away. */
function FittedPicture({ image, width: widest }: { image: ReportImage; width: number }) {
  const [ratio, onSize] = usePictureRatio(image.src, 4 / 3);
  // A tall picture held to the height cap narrows with it, so the frame stays its shape.
  const width = Math.min(widest, Math.round(MAX_HEIGHT * ratio));
  const height = Math.round(width / ratio);
  return (
    <View style={[styles.picture, { width }]}>
      <PondPicture
        path={image.src}
        label={image.caption ?? image.credit}
        contentFit="contain"
        style={[styles.frame, { width, height }]}
        onSize={onSize}
      />
      <InkText size="xs" tone="tertiary" numberOfLines={2}>
        {image.credit}
      </InkText>
    </View>
  );
}

/** The Pond's pictures for the pages, each with its credit under it. */
export function PagePictures({ pictures }: { pictures: ReportImage[] }) {
  if (pictures.length === 0) return null;
  const width = pictures.length === 1 ? ONE_WIDTH : SOME_WIDTH;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pictures}>
      {pictures.map((image) => (
        <FittedPicture key={image.key} image={image} width={width} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  cardHead: { flexDirection: 'row', gap: Spacing.md },
  cardText: { flex: 1, gap: 2 },
  thumb: { width: 72, height: 72, borderRadius: 10 },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  pictures: { gap: Spacing.md, alignItems: 'flex-start' },
  picture: { gap: Spacing.xs },
  frame: { borderRadius: 12 },
});
