/**
 * Where an answer or a report came from, kept small: each cited page is a numbered chip in the
 * text, the pages sit folded in one "N sources" chip that opens into numbered chips, and a chip
 * opens a card in place with the page's title, site and picture and a way to the page. Under them,
 * the pictures the Pond kept for those pages, each in its own shape and credited, which the phone
 * loads from the Pond, never the site.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkChip, InkText, useInkTheme } from '@jarida/ink/native';

import type { SourceChips } from '@/components/patterns/markdown';
import { PondPicture, usePictureRatio } from '@/components/patterns/pond-picture';
import { GPressable } from '@/components/ui/g-pressable';
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

/** Room left at the screen's edges, narrower than the text's, so a picture reads wider than the words. */
const GUTTER = Spacing.sm;
/** How much of the next picture shows beside one of several, to say there are more. */
const PEEK = 40;
/** A picture is never wider than this, so a tablet does not draw one the size of the screen. */
const WIDEST = 640;
/** Of the screen's height, the most a picture takes; a taller one narrows and centres instead. */
const TALLEST = 0.62;
/** Under this a picture is a thumbnail stretched to fill the line, so it keeps its own size. */
const SMALLEST = 120;

/** A picture framed in its own shape once its size is known, so nothing of it is cut away. */
function FittedPicture({
  image,
  width: widest,
  height: tallest,
  onOpen,
}: {
  image: ReportImage;
  width: number;
  height: number;
  onOpen?: (image: ReportImage) => void;
}) {
  const theme = useInkTheme();
  const [ratio, onSize] = usePictureRatio(image.src, 4 / 3);
  // A tall picture held to the height cap narrows with it, so the frame stays its shape.
  const width = Math.max(SMALLEST, Math.min(widest, Math.round(tallest * ratio)));
  const height = Math.round(width / ratio);
  return (
    <View style={[styles.picture, { width: widest }]}>
      <GPressable
        feedback="lift"
        disabled={!onOpen}
        onPress={() => onOpen?.(image)}
        accessibilityRole="imagebutton"
        accessibilityLabel={image.caption ?? image.credit}
      >
        <PondPicture
          path={image.src}
          label={image.caption ?? image.credit}
          contentFit="contain"
          style={[styles.frame, { width, height, borderRadius: theme.radius.xl }]}
          onSize={onSize}
        />
      </GPressable>
      <InkText size="xs" tone="tertiary" numberOfLines={2} style={styles.credit}>
        {image.credit}
      </InkText>
    </View>
  );
}

/**
 * The Pond's pictures for the pages, each with its credit under it, reaching past the text to the
 * screen's edges: one alone centred, several in a strip that stops on each. `inset` is how far the
 * column it sits in starts from the screen's left edge.
 */
export function PagePictures({
  pictures,
  inset = 0,
  onOpen,
}: {
  pictures: ReportImage[];
  inset?: number;
  /** A tap on a picture, to open it. */
  onOpen?: (image: ReportImage) => void;
}) {
  const screen = useWindowDimensions();
  if (pictures.length === 0) return null;
  const several = pictures.length > 1;
  const width = Math.min(WIDEST, screen.width - GUTTER * 2 - (several ? PEEK : 0));
  const height = Math.round(screen.height * TALLEST);
  return (
    <ScrollView
      horizontal
      scrollEnabled={several}
      showsHorizontalScrollIndicator={false}
      snapToInterval={width + Spacing.md}
      decelerationRate="fast"
      style={{ width: screen.width, marginLeft: -inset }}
      contentContainerStyle={[styles.pictures, several ? null : styles.alone]}
    >
      {pictures.map((image) => (
        <FittedPicture key={image.key} image={image} width={width} height={height} onOpen={onOpen} />
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
  pictures: { gap: Spacing.md, alignItems: 'flex-start', paddingHorizontal: GUTTER },
  alone: { flexGrow: 1, justifyContent: 'center' },
  picture: { gap: Spacing.xs, alignItems: 'center' },
  frame: { overflow: 'hidden' },
  credit: { alignSelf: 'stretch', paddingHorizontal: Spacing.sm },
});
