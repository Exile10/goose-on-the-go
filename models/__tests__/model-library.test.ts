/**
 * The models on a Pond as the Models pages read them: which job each holds, what a download adds up
 * to across its files, and how sizes are written.
 */

import {
  candidatesFor,
  downloadsByModel,
  formatBytes,
  formatMegabytes,
  fractionDone,
  holderOf,
  pondModelId,
  recommendations,
  roleOf,
  rollbackTarget,
  routeCategory,
  titleOf,
  tooBig,
} from '@/models/model-library';
import type { DownloadEntry, ModelEntry } from '@/services/types';

const model = (patch: Partial<ModelEntry>): ModelEntry => ({
  id: `${patch.category ?? 'gguf'}:${patch.name ?? 'm'}`,
  category: 'gguf',
  name: 'm',
  active: false,
  downloaded: true,
  ...patch,
});

describe('jobs', () => {
  it('gives each kind of model its job', () => {
    expect(roleOf(model({ category: 'gguf' }))).toBe('chat');
    expect(roleOf(model({ category: 'litert' }))).toBe('chat');
    expect(roleOf(model({ category: 'whisper' }))).toBe('asr');
    expect(roleOf(model({ category: 'tts' }))).toBe('tts');
    expect(roleOf(model({ category: 'embedding' }))).toBe('embedding');
  });

  it('finds the model holding a job', () => {
    const models = [model({ name: 'a', active: true }), model({ name: 'b', category: 'whisper', active: true })];
    expect(holderOf(models, 'chat')?.name).toBe('a');
    expect(holderOf(models, 'embedding')).toBeNull();
  });

  it('offers only models on the Pond that it can run', () => {
    const models = [
      model({ name: 'here' }),
      model({ name: 'away', downloaded: false }),
      model({ name: 'cannot', available: false }),
      model({ name: 'voice', category: 'tts' }),
    ];
    expect(candidatesFor(models, 'chat').map((m) => m.name)).toEqual(['here']);
  });

  it('goes back only to a model that is still on the Pond and not already doing the job', () => {
    const models = [
      model({ name: 'now', active: true }),
      model({ name: 'before' }),
      model({ name: 'gone', downloaded: false }),
    ];
    expect(rollbackTarget(models, 'chat', 'gguf:before')?.name).toBe('before');
    expect(rollbackTarget(models, 'chat', 'gguf:gone')).toBeNull();
    expect(rollbackTarget(models, 'chat', 'gguf:now')).toBeNull();
    expect(rollbackTarget(models, 'asr', 'gguf:before')).toBeNull();
    expect(rollbackTarget(models, 'chat', undefined)).toBeNull();
  });

  it('names a model by the Pond’s own category, not the bucket it came in', () => {
    const voice = model({ category: 'tts', pond_category: 'tts_kokoro', name: 'af_heart' });
    expect(routeCategory(voice)).toBe('tts_kokoro');
    expect(pondModelId(voice)).toBe('tts_kokoro/af_heart');
    expect(routeCategory(model({ category: 'whisper' }))).toBe('whisper');
  });

  it('uses the title a household reads, or the name when there is none', () => {
    expect(titleOf(model({ name: 'qwen3-4b', title: 'Qwen 3 4B' }))).toBe('Qwen 3 4B');
    expect(titleOf(model({ name: 'qwen3-4b', title: ' ' }))).toBe('qwen3-4b');
  });

  it('suggests what is recommended and not already working, best first', () => {
    const models = [
      model({ name: 'b', recommended: { rank: 'alternative', reason: '' } }),
      model({ name: 'a', recommended: { rank: 'primary', reason: '' } }),
      model({ name: 'c', active: true, recommended: { rank: 'primary', reason: '' } }),
    ];
    expect(recommendations(models).map((m) => m.name)).toEqual(['a', 'b']);
  });

  it('says when a model is too big for one model’s room on this Pond', () => {
    expect(tooBig(model({ ram_estimate_mb: 9000 }), 6000)).toBe(true);
    expect(tooBig(model({ ram_estimate_mb: 3000 }), 6000)).toBe(false);
    expect(tooBig(model({ ram_estimate_mb: 9000 }), undefined)).toBe(false);
  });
});

describe('downloads', () => {
  const part = (patch: Partial<DownloadEntry>): DownloadEntry => ({
    filename: 'f.gguf',
    category: 'gguf',
    downloaded_bytes: 0,
    total_bytes: 100,
    status: 'downloading',
    model_id: 'gguf/a',
    part: 'model',
    ...patch,
  });

  it('adds a model’s file and its picture add-on into one download', () => {
    const [d] = downloadsByModel([
      part({ downloaded_bytes: 50, total_bytes: 100 }),
      part({ filename: 'mmproj.gguf', part: 'pictures', downloaded_bytes: 10, total_bytes: 20 }),
    ]);
    expect(d).toMatchObject({ modelId: 'gguf/a', downloaded: 60, total: 120, status: 'downloading', filename: 'f.gguf' });
    expect(fractionDone(d)).toBe(0.5);
  });

  it('calls a download failed when any part failed', () => {
    const [d] = downloadsByModel([part({ status: 'done' }), part({ part: 'pictures', status: 'error', error: 'disk full', resumable: true })]);
    expect(d).toMatchObject({ status: 'error', error: 'disk full', resumable: true });
  });

  it('keeps a size it does not know unknown, rather than a wrong total', () => {
    const [d] = downloadsByModel([part({ total_bytes: null })]);
    expect(d.total).toBeNull();
    expect(fractionDone(d)).toBeNull();
  });

  it('keeps a download the catalogue has no row for, under its file name', () => {
    expect(downloadsByModel([part({ model_id: undefined, filename: 'x.gguf' })])[0].modelId).toBe('x.gguf');
  });
});

describe('sizes', () => {
  it('writes bytes as a household reads them', () => {
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB');
    expect(formatBytes(86 * 1024 ** 2)).toBe('86 MB');
    expect(formatBytes(2.5 * 1024 ** 2)).toBe('2.5 MB');
    expect(formatBytes(0)).toBeNull();
    expect(formatBytes(null)).toBeNull();
    expect(formatMegabytes(4300)).toBe('4.2 GB');
  });
});
