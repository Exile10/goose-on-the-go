/**
 * Hand a CSV of the Pond's log to the phone's share sheet (issue #15): saved
 * to Files, mailed to whoever is helping, opened in a spreadsheet.
 *
 * The share sheet takes a file, not text, so the CSV is written to the cache
 * first. The cache is the right place: the file is a copy for passing on, and
 * the system may clear it.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { exportFileName } from '@/models/log';

/** Thrown when this device has no share sheet to hand the file to. */
export class SharingUnavailableError extends Error {
  constructor() {
    super('Sharing is not available on this device');
    this.name = 'SharingUnavailableError';
  }
}

/** Write `csv` to a dated file and open the share sheet with it. Resolves when the sheet closes. */
export async function shareLogsCsv(csv: string, date: Date = new Date()): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new SharingUnavailableError();
  const file = new File(Paths.cache, exportFileName(date));
  file.create({ overwrite: true });
  file.write(csv);
  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/csv',
    UTI: 'public.comma-separated-values-text',
  });
}
