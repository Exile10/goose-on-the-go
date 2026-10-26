/**
 * The pictures a list scrolls past: each read once, kept for a while, and never more than a few
 * asked of the Pond at the same moment.
 */

import { api } from '@/services/api-client';
import { forgetPondImages, loadPondImage, peekPondImage } from '@/services/pond-images';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => ({ api: { fetchImage: jest.fn() } }));

const pond = jest.mocked(api);

beforeEach(() => {
  forgetPondImages();
  pond.fetchImage.mockReset();
  pond.fetchImage.mockImplementation(async (path: string) => `data:image/jpeg;base64,${path}`);
});

it('reads a picture once and serves it from memory after', async () => {
  await expect(loadPondImage('/api/v1/camera/events/1/snapshot', 'a')).resolves.toBe('data:image/jpeg;base64,/api/v1/camera/events/1/snapshot');
  await loadPondImage('/api/v1/camera/events/1/snapshot', 'a');

  expect(pond.fetchImage).toHaveBeenCalledTimes(1);
  expect(peekPondImage('/api/v1/camera/events/1/snapshot', 'a')).not.toBeNull();
});

it('gives two askers at once one read', async () => {
  const [a, b] = await Promise.all([loadPondImage('/api/v1/x', 'v'), loadPondImage('/api/v1/x', 'v')]);

  expect(a).toBe(b);
  expect(pond.fetchImage).toHaveBeenCalledTimes(1);
});

it('tells two pictures at one path apart by their version', async () => {
  await loadPondImage('/api/v1/camera/events/1/snapshot', 'pond-a');
  await loadPondImage('/api/v1/camera/events/1/snapshot', 'pond-b');

  expect(pond.fetchImage).toHaveBeenCalledTimes(2);
});

it('asks the Pond for no more than three at a time', async () => {
  const releases: (() => void)[] = [];
  let inFlight = 0;
  let most = 0;
  pond.fetchImage.mockImplementation(
    (path: string) =>
      new Promise<string>((resolve) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        releases.push(() => {
          inFlight -= 1;
          resolve(`data:${path}`);
        });
      }),
  );

  const all = Promise.all(Array.from({ length: 8 }, (_, i) => loadPondImage(`/api/v1/p/${i}`)));
  await Promise.resolve();
  while (releases.length < 8) {
    releases.shift()?.();
    await new Promise((r) => setTimeout(r, 0));
    if (releases.length === 0 && inFlight === 0) break;
  }
  // Let the rest through one wave at a time.
  for (let i = 0; i < 20; i++) {
    releases.splice(0).forEach((release) => release());
    await new Promise((r) => setTimeout(r, 0));
  }
  await all;

  expect(pond.fetchImage).toHaveBeenCalledTimes(8);
  expect(most).toBe(3);
});

it('does not keep a failed read, so the next ask tries again', async () => {
  pond.fetchImage.mockRejectedValueOnce(new Error('offline'));

  await expect(loadPondImage('/api/v1/y')).rejects.toThrow('offline');
  await expect(loadPondImage('/api/v1/y')).resolves.toContain('/api/v1/y');
});

it('lets the least recently used go once it holds a few dozen', async () => {
  for (let i = 0; i < 45; i++) await loadPondImage(`/api/v1/p/${i}`);

  expect(peekPondImage('/api/v1/p/0')).toBeNull();
  expect(peekPondImage('/api/v1/p/44')).not.toBeNull();
});

it('keeps a picture that is still being looked at', async () => {
  for (let i = 0; i < 40; i++) await loadPondImage(`/api/v1/p/${i}`);
  await loadPondImage('/api/v1/p/0');
  for (let i = 40; i < 44; i++) await loadPondImage(`/api/v1/p/${i}`);

  expect(peekPondImage('/api/v1/p/0')).not.toBeNull();
  expect(peekPondImage('/api/v1/p/1')).toBeNull();
});

it('forgets everything on request, so a household’s cameras are not left in memory', async () => {
  await loadPondImage('/api/v1/z');
  forgetPondImages();

  expect(peekPondImage('/api/v1/z')).toBeNull();
});
