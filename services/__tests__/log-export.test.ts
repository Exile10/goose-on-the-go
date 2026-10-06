/**
 * Exporting the Pond's log: the CSV lands in a dated file in the cache, and
 * that file, not the text, goes to the share sheet.
 */

import * as Sharing from 'expo-sharing';
import { SharingUnavailableError, shareLogsCsv } from '@/services/log-export';

const mockWritten: { name: string; text: string }[] = [];

jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: jest.fn().mockImplementation((dir: string, name: string) => ({
    uri: `${dir}/${name}`,
    create: jest.fn(),
    write: (text: string) => mockWritten.push({ name, text }),
  })),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

const isAvailable = Sharing.isAvailableAsync as jest.Mock;
const share = Sharing.shareAsync as jest.Mock;

beforeEach(() => {
  mockWritten.length = 0;
  isAvailable.mockReset().mockResolvedValue(true);
  share.mockReset().mockResolvedValue(undefined);
});

it('writes the CSV to a dated file and shares that file as CSV', async () => {
  await shareLogsCsv('id\n1\n', new Date(2026, 9, 6, 10));

  expect(mockWritten).toEqual([{ name: 'pond-logs-2026-10-06.csv', text: 'id\n1\n' }]);
  expect(share).toHaveBeenCalledWith('file:///cache/pond-logs-2026-10-06.csv', {
    mimeType: 'text/csv',
    UTI: 'public.comma-separated-values-text',
  });
});

it('writes nothing when the device cannot share', async () => {
  isAvailable.mockResolvedValue(false);

  await expect(shareLogsCsv('id\n')).rejects.toBeInstanceOf(SharingUnavailableError);
  expect(mockWritten).toEqual([]);
  expect(share).not.toHaveBeenCalled();
});
