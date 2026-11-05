/**
 * Markdown — a reply from Goose, set in the house type.
 *
 * Not a third-party renderer: each brings its own stylesheet, and on Android a
 * custom font has no weights, only files, so bold has to come from `inkText` or
 * it renders regular. The reply stays the page's text; only code and tables get
 * a ground of their own, because they scroll sideways instead of wrapping.
 */

import React, { useMemo } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { inkText, useInkTheme, type InkTextSpec } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { decodeEntities, htmlAsText, isMapLink, parseReply, webLink, type MarkedToken, type Token, type Tokens } from '@/services/markdown';

type Theme = ReturnType<typeof useInkTheme>;
type Role = NonNullable<InkTextSpec['role']>;
type Weight = NonNullable<InkTextSpec['weight']>;

/** What an inline run inherits from the spans around it. */
interface Span {
  role: Role;
  weight: Weight;
  italic: boolean;
  size: number;
}

/**
 * How large the text is set: a reply's body (`md`), a card's title, or a card's quieter lines in
 * Ink's own `base` and `sm`. Below `md`, headings shrink with it: a card has no room for a reply's.
 */
export type MarkdownSize = 'md' | 'title' | 'base' | 'sm';

/** Where a block sits: a quote recolours what it holds, and a nested list changes its bullet. */
interface Place {
  theme: Theme;
  tone: string;
  depth: number;
  size: MarkdownSize;
  /** Off inside a card: selectable text on Android takes the touch the card is waiting for. */
  selectable: boolean;
}

/** Quicksand at 13px, erring wide; every row of a column needs one width, so it is estimated, not measured. */
const CELL_CHAR = 8.5;
const CELL_MIN = 64;
const CELL_MAX = 220;

const heavier = (a: Weight, b: Weight): Weight => (a > b ? a : b);

// Ink fakes italic with a skew, which a nested span cannot take, so emphasis falls back to weight.
const trueItalic = (theme: Theme) => theme.hasTrueItalic || Platform.OS === 'web';

function face(theme: Theme, span: Span): TextStyle {
  const { style } = inkText(theme, { role: span.role, weight: span.weight, italic: span.italic && theme.hasTrueItalic });
  return { fontFamily: style.fontFamily, fontStyle: span.italic && trueItalic(theme) ? 'italic' : 'normal' };
}

function link(href: string, children: React.ReactNode, place: Place, key: number) {
  const url = webLink(href);
  if (!url) return <React.Fragment key={key}>{children}</React.Fragment>;
  // A map opens where the phone opens maps; the rest in the in-app browser, beside the reply.
  const open = () => void (isMapLink(url) ? Linking.openURL(url) : WebBrowser.openBrowserAsync(url));
  return (
    <Text
      key={key}
      accessibilityRole="link"
      onPress={open}
      style={[styles.link, { color: place.theme.color.accentLine }]}
    >
      {children}
    </Text>
  );
}

function spans(tokens: Token[] | undefined, place: Place, span: Span): React.ReactNode[] {
  return (tokens ?? []).map((token, i) => inline(token as MarkedToken, place, span, i));
}

function inline(token: MarkedToken, place: Place, span: Span, key: number): React.ReactNode {
  const { theme } = place;
  switch (token.type) {
    case 'text':
      return token.tokens ? (
        <React.Fragment key={key}>{spans(token.tokens, place, span)}</React.Fragment>
      ) : (
        decodeEntities(token.text)
      );
    case 'escape':
      return token.text;
    case 'strong': {
      const next = { ...span, weight: theme.weight.bold };
      return (
        <Text key={key} style={face(theme, next)}>
          {spans(token.tokens, place, next)}
        </Text>
      );
    }
    case 'em': {
      const next = { ...span, italic: true, weight: trueItalic(theme) ? span.weight : heavier(span.weight, theme.weight.semibold) };
      return (
        <Text key={key} style={face(theme, next)}>
          {spans(token.tokens, place, next)}
        </Text>
      );
    }
    case 'del':
      return (
        <Text key={key} style={styles.struck}>
          {spans(token.tokens, place, span)}
        </Text>
      );
    case 'codespan': {
      const mono = face(theme, { ...span, role: 'mono', weight: theme.weight.regular, italic: false });
      return (
        <Text key={key} style={[mono, { fontSize: Math.round(span.size * 0.88), backgroundColor: theme.color.neutralSoft }]}>
          {` ${token.text} `}
        </Text>
      );
    }
    case 'link':
      return link(token.href, spans(token.tokens, place, span), place, key);
    // Shown as its link rather than fetched: a reply should not reach off the Pond on its own.
    case 'image':
      return link(token.href, token.text || token.href, place, key);
    case 'br':
      return '\n';
    case 'html':
      return htmlAsText(token.text);
    case 'checkbox':
      return null;
    default:
      return token.raw;
  }
}

function bodySpec(place: Place): InkTextSpec {
  const { theme, tone } = place;
  if (place.size === 'title') {
    return { role: 'display', size: 'lg', weight: theme.weight.bold, tracking: 'snug', leading: 'snug', color: tone };
  }
  return { size: place.size, leading: 'base', color: tone };
}

function bodySpan(place: Place): Span {
  const spec = bodySpec(place);
  const { theme } = place;
  return { role: spec.role ?? 'body', weight: spec.weight ?? theme.weight.regular, italic: false, size: theme.size[spec.size ?? 'md'] };
}

function paragraph(tokens: Token[] | undefined, text: string, place: Place, key: number) {
  const body = inkText(place.theme, bodySpec(place));
  const span = bodySpan(place);
  return (
    <Text key={key} selectable={place.selectable} style={body.style}>
      {tokens ? spans(tokens, place, span) : decodeEntities(text)}
    </Text>
  );
}

function heading(token: Tokens.Heading, place: Place, key: number) {
  const { theme, tone } = place;
  const spec: InkTextSpec =
    place.size !== 'md'
      ? { ...bodySpec(place), weight: token.depth <= 3 ? theme.weight.bold : theme.weight.semibold, leading: 'snug' }
      : token.depth === 1
      ? { role: 'display', size: 'xl', weight: theme.weight.bold, tracking: 'title', leading: 'snug', color: tone }
      : token.depth === 2
        ? { role: 'display', size: 'lg', weight: theme.weight.bold, leading: 'snug', color: tone }
        : token.depth === 3
          ? { size: 'md', weight: theme.weight.bold, leading: 'snug', color: tone }
          : { size: 'md', weight: theme.weight.semibold, leading: 'snug', color: theme.color.textSecondary };
  const span: Span = {
    role: spec.role ?? 'body',
    weight: spec.weight ?? theme.weight.bold,
    italic: false,
    size: theme.size[spec.size ?? 'md'],
  };
  return (
    <Text
      key={key}
      selectable={place.selectable}
      accessibilityRole="header"
      style={[inkText(theme, spec).style, key > 0 ? styles.headingGap : null]}
    >
      {spans(token.tokens, place, span)}
    </Text>
  );
}

function code(token: Tokens.Code, place: Place, key: number) {
  const { theme } = place;
  const lang = token.lang?.split(/\s/)[0];
  const label = inkText(theme, { role: 'mono', size: 'xs', tracking: 'wide', uppercase: true, color: theme.color.textTertiary });
  const text = inkText(theme, { role: 'mono', size: 'base', leading: 'base' });
  return (
    <View key={key} style={[styles.code, { backgroundColor: theme.color.neutralSoft, borderRadius: theme.radius.md }]}>
      {lang ? <Text style={[label.style, styles.lang]}>{lang}</Text> : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.codeScroll, lang ? styles.codeAfterLang : null]}
      >
        <Text selectable={place.selectable} style={text.style}>
          {token.text}
        </Text>
      </ScrollView>
    </View>
  );
}

function marker(token: Tokens.List, item: Tokens.ListItem, index: number, place: Place) {
  const { theme, depth } = place;
  if (item.task) {
    return (
      <View
        style={[
          styles.box,
          { borderRadius: theme.radius.xs, borderColor: item.checked ? theme.color.text : theme.color.lineStrong },
        ]}
      >
        {item.checked ? <GIcon name="check" size={10} color={theme.color.text} /> : null}
      </View>
    );
  }
  if (token.ordered) {
    const first = typeof token.start === 'number' ? token.start : 1;
    const number = inkText(theme, { ...bodySpec(place), weight: theme.weight.regular, color: theme.color.textSecondary });
    return <Text style={[number.style, styles.number]}>{`${first + index}.`}</Text>;
  }
  const ink = theme.color.textSecondary;
  if (depth === 0) return <View style={[styles.dot, { backgroundColor: ink }]} />;
  if (depth === 1) return <View style={[styles.dot, styles.ring, { borderColor: ink }]} />;
  return <View style={[styles.square, { backgroundColor: ink }]} />;
}

function list(token: Tokens.List, place: Place, key: number) {
  const line = inkText(place.theme, bodySpec(place)).style.lineHeight;
  const first = typeof token.start === 'number' ? token.start : 1;
  // Wide enough for the longest number, so every item's text starts on one edge.
  const width = token.ordered ? 10 + 8 * String(first + token.items.length - 1).length : 14;
  const inner = { ...place, depth: place.depth + 1 };
  return (
    <View key={key} style={token.loose ? styles.loose : styles.tight}>
      {token.items.map((item, i) => (
        <View key={i} style={styles.item}>
          <View style={[styles.marker, { height: line, width }]}>{marker(token, item, i, place)}</View>
          <View style={[styles.itemBody, token.loose ? styles.loose : styles.tight]}>{blocks(item.tokens, inner)}</View>
        </View>
      ))}
    </View>
  );
}

function table(token: Tokens.Table, place: Place, key: number) {
  const { theme, tone } = place;
  const widths = token.header.map((cell, c) => {
    const longest = Math.max(cell.text.length, ...token.rows.map((row) => row[c]?.text.length ?? 0));
    return Math.min(CELL_MAX, Math.max(CELL_MIN, Math.ceil(longest * CELL_CHAR) + 24));
  });
  const row = (cells: Tokens.TableCell[], header: boolean, r: number) => {
    const weight = header ? theme.weight.semibold : theme.weight.regular;
    const text = inkText(theme, { size: 'base', leading: 'base', weight, color: tone });
    const span: Span = { role: 'body', weight, italic: false, size: theme.size.base };
    return (
      <View
        key={r}
        style={[
          styles.row,
          header
            ? { backgroundColor: theme.color.neutralSoft }
            : { borderTopWidth: theme.edge.hairlineWidth, borderTopColor: theme.color.line },
        ]}
      >
        {cells.map((cell, c) => (
          <View key={c} style={[styles.cell, { width: widths[c] }]}>
            <Text selectable={place.selectable} style={[text.style, { textAlign: cell.align ?? 'left' }]}>
              {spans(cell.tokens, place, span)}
            </Text>
          </View>
        ))}
      </View>
    );
  };
  return (
    <ScrollView key={key} horizontal showsHorizontalScrollIndicator={false}>
      <View
        style={[
          styles.table,
          { borderColor: theme.color.line, borderWidth: theme.edge.hairlineWidth, borderRadius: theme.radius.md },
        ]}
      >
        {row(token.header, true, 0)}
        {token.rows.map((cells, r) => row(cells, false, r + 1))}
      </View>
    </ScrollView>
  );
}

function block(token: MarkedToken, place: Place, key: number): React.ReactNode {
  const { theme } = place;
  switch (token.type) {
    case 'paragraph':
    // A tight list item's body.
    case 'text':
      return paragraph(token.tokens, token.text, place, key);
    case 'heading':
      return heading(token, place, key);
    case 'code':
      return code(token, place, key);
    case 'blockquote':
      return (
        <View key={key} style={[styles.quote, { borderLeftColor: theme.color.lineStrong }]}>
          {blocks(token.tokens, { ...place, tone: theme.color.textSecondary })}
        </View>
      );
    case 'list':
      return list(token, place, key);
    case 'table':
      return table(token, place, key);
    case 'hr':
      return <View key={key} style={[styles.rule, { height: theme.edge.hairlineWidth, backgroundColor: theme.color.line }]} />;
    case 'html': {
      const text = htmlAsText(token.text).trim();
      return text ? paragraph(undefined, text, place, key) : null;
    }
    default:
      return null;
  }
}

function blocks(tokens: Token[] | undefined, place: Place): React.ReactNode[] {
  return (tokens ?? []).map((token, i) => block(token as MarkedToken, place, i));
}

export interface MarkdownProps {
  source: string;
  size?: MarkdownSize;
  tone?: 'primary' | 'secondary' | 'tertiary';
  selectable?: boolean;
}

export const Markdown = React.memo(function Markdown({
  source,
  size = 'md',
  tone = 'primary',
  selectable = true,
}: MarkdownProps) {
  const theme = useInkTheme();
  const tokens = useMemo(() => parseReply(source), [source]);
  const color =
    tone === 'secondary' ? theme.color.textSecondary : tone === 'tertiary' ? theme.color.textTertiary : theme.color.text;
  return (
    <View style={size === 'md' ? styles.page : styles.compact}>
      {blocks(tokens, { theme, tone: color, depth: 0, size, selectable })}
    </View>
  );
});

const styles = StyleSheet.create({
  page: { gap: 12 },
  compact: { gap: 6 },
  headingGap: { marginTop: 8 },
  link: { textDecorationLine: 'underline' },
  struck: { textDecorationLine: 'line-through' },
  quote: { borderLeftWidth: 2, paddingLeft: 12, gap: 8 },
  rule: { marginVertical: 4 },
  code: { overflow: 'hidden' },
  lang: { paddingHorizontal: 12, paddingTop: 8 },
  codeScroll: { padding: 12 },
  codeAfterLang: { paddingTop: 4 },
  tight: { gap: 4 },
  loose: { gap: 8 },
  item: { flexDirection: 'row', gap: 8 },
  marker: { alignItems: 'center', justifyContent: 'center' },
  itemBody: { flex: 1 },
  number: { alignSelf: 'stretch', textAlign: 'right', fontVariant: ['tabular-nums'] },
  dot: { width: 6, height: 6, borderRadius: 3 },
  ring: { backgroundColor: 'transparent', borderWidth: 1.25 },
  square: { width: 5, height: 5, borderRadius: 1 },
  box: { width: 14, height: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  table: { overflow: 'hidden' },
  row: { flexDirection: 'row' },
  cell: { paddingHorizontal: 12, paddingVertical: 8 },
});
