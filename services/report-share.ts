// A long task's report, written to the cache under the Pond's file name and handed to the share sheet,
// as log export does. The file is overwritten by the next share of the same name and never read back.

import { File, Paths } from 'expo-file-system';
import { getLocales } from 'expo-localization';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { SharingUnavailableError } from './log-export';

export { SharingUnavailableError };

/** Resolves when the sheet closes. `name` has already been checked (`reportFileName`). */
export async function shareReportFile(name: string, body: string, type: { mimeType: string; uti: string }): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new SharingUnavailableError();
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(body);
  await Sharing.shareAsync(file.uri, { mimeType: type.mimeType, UTI: type.uti });
}

// Points, at 72 to the inch: Letter where offices use it, A4 everywhere else.
const LETTER_REGIONS = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO']);
const A4 = { width: 595, height: 842 };
const LETTER = { width: 612, height: 792 };
const MARGIN = 40;

export function pdfPage(region: string | null | undefined): { width: number; height: number } {
  return region && LETTER_REGIONS.has(region) ? LETTER : A4;
}

/**
 * expo-print is native, so a development build from before it was added has none. Requiring it there
 * outside start-up is a fatal error rather than a throw, hence the look first.
 */
export function canMakePdf(): boolean {
  return requireOptionalNativeModule('ExpoPrint') !== null;
}

/** Prints the report's web page to a PDF called `name` and shares that. Resolves when the sheet closes. */
export async function shareReportPdf(name: string, html: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new SharingUnavailableError();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { printToFileAsync } = require('expo-print') as typeof import('expo-print');
  // Android takes page margins only from the page's CSS, iOS only from the option.
  const style = `<style>@page{margin:${MARGIN}pt}</style>`;
  const page = Platform.OS === 'android' ? (html.includes('</head>') ? html.replace('</head>', `${style}</head>`) : style + html) : html;
  const printed = await printToFileAsync({
    html: page,
    ...pdfPage(getLocales()[0]?.regionCode),
    margins: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
  });
  const file = new File(Paths.cache, name);
  await new File(printed.uri).move(file, { overwrite: true });
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}
