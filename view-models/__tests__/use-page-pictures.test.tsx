// An answer's pictures are asked for once per set of pages, but a failed ask is not remembered: the
// Pond fetches a picture while asked, slower than the phone waits, and keeps it for the next ask.

import React from 'react';
import { act, create } from 'react-test-renderer';

import { api } from '@/services/api-client';
import type { ReportImage } from '@/models/web-watches';
import { usePagePictures } from '../use-page-pictures';

jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true }) }));
jest.mock('@/services/api-client', () => ({ api: { pagePictures: jest.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pagePictures = jest.mocked(api.pagePictures);
const picture: ReportImage = { key: 'k', src: '/api/v1/report-images/k', credit: 'CC BY-SA 4.0', page: 'https://en.wikipedia.org/wiki/X' };

async function shown(pages: string[]): Promise<ReportImage[]> {
  let seen: ReportImage[] = [];
  function Probe() {
    seen = usePagePictures(pages, true);
    return null;
  }
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<Probe />);
  });
  await act(async () => {});
  act(() => tree.unmount());
  return seen;
}

it('asks again after a failed ask, and shows what the Pond kept by then', async () => {
  pagePictures.mockRejectedValueOnce(new Error('timed out')).mockResolvedValueOnce([picture]);
  expect(await shown(['https://en.wikipedia.org/wiki/X'])).toEqual([]);
  expect(await shown(['https://en.wikipedia.org/wiki/X'])).toEqual([picture]);
  expect(pagePictures).toHaveBeenCalledTimes(2);
});

it('remembers an answer that came back, so scrolling past does not ask again', async () => {
  pagePictures.mockClear().mockResolvedValueOnce([picture]);
  expect(await shown(['https://en.wikipedia.org/wiki/Y'])).toEqual([picture]);
  expect(await shown(['https://en.wikipedia.org/wiki/Y'])).toEqual([picture]);
  expect(pagePictures).toHaveBeenCalledTimes(1);
});
