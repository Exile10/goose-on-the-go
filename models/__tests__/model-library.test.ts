/**
 * The models on a Pond as the Models pages read them: which job each holds, what a download adds up
 * to across its files, and how sizes are written.
 */

import {
  candidatesFor,
  downloadsByModel,
  fetchedByPond,
  formatBytes,
  formatMegabytes,
  fractionDone,
  helpersOf,
  holderOf,
  pondModelId,
  recommendations,
  roleOf,
  rollbackTarget,
  routeCategory,
  sectionOf,
  sectionsOnPond,
  titleOf,
  tooBig,
  usesOf,
  withRole,
} from '@/models/model-library';
import type { DownloadEntry, HelperModel, ModelEntry } from '@/services/types';

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

  it('offers a memory model the Pond fetches itself, which never has a file to download', () => {
    const builtIn = model({ category: 'embedding', name: 'all-MiniLM-L6-v2', downloaded: false, acquire: 'external' });
    const fetched = model({ category: 'embedding', name: 'gemma-embed', downloaded: false, acquire: 'download' });
    expect(fetchedByPond(builtIn)).toBe(true);
    expect(fetchedByPond(fetched)).toBe(false);
    expect(candidatesFor([builtIn, fetched], 'embedding').map((m) => m.name)).toEqual(['all-MiniLM-L6-v2']);
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
      // The Pond's roles decide, not the assignment flag.
      model({ name: 'd', active: false, roles: ['chat'], recommended: { rank: 'primary', reason: '' } }),
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

describe('sections', () => {
  const helper = (patch: Partial<HelperModel>): HelperModel => ({
    id: 'h',
    title: null,
    uses: ['pictures'],
    section: 'pictures',
    serves: null,
    ...patch,
  });

  it('reads the jobs a row is doing from the Pond, not from its assignment flag', () => {
    expect(usesOf(model({ category: 'embedding', active: false, roles: ['embedding'] }))).toEqual(['embedding']);
    expect(usesOf(model({ category: 'gguf', active: true, roles: [] }))).toEqual([]);
    expect(usesOf(model({ category: 'gguf', roles: ['chat', 'tool'] }))).toEqual(['chat', 'tool']);
  });

  it('falls back to the assigned category job on a Pond that does not say', () => {
    expect(usesOf(model({ category: 'whisper', active: true }))).toEqual(['asr']);
    expect(usesOf(model({ category: 'whisper', active: false }))).toEqual([]);
  });

  it('leaves off a job this phone has no words for', () => {
    expect(usesOf(model({ roles: ['chat', 'reranking' as never] }))).toEqual(['chat']);
  });

  it('lists a row under the Pond’s section, else under its category’s job', () => {
    expect(sectionOf(model({ category: 'gguf', section: 'other' }))).toBe('other');
    expect(sectionOf(model({ category: 'whisper' }))).toBe('listening');
    expect(sectionOf(model({ category: 'tts' }))).toBe('speaking');
    expect(sectionOf(model({ category: 'embedding' }))).toBe('memory');
    expect(sectionOf(model({ category: 'gguf' }))).toBe('conversation');
  });

  it('divides what is on the Pond into sections in order, working rows first, empty ones left out', () => {
    const groups = sectionsOnPond(
      [
        model({ name: 'e2b', section: 'conversation', roles: [] }),
        model({ name: 'e4b', section: 'conversation', roles: ['chat'] }),
        model({ category: 'whisper', name: 'base', section: 'listening', roles: ['asr'] }),
        model({ category: 'tts', name: 'af_heart', section: 'speaking', roles: ['tts'] }),
        model({ category: 'gguf', name: 'tool', section: 'other', roles: ['tool'] }),
      ],
      [helper({ id: 'camera_detector', title: 'YOLOX-Nano', uses: ['camera'] })],
    );
    expect(groups.map((g) => g.section)).toEqual(['conversation', 'listening', 'speaking', 'pictures', 'other']);
    expect(groups[0].entries.map((e) => (e.kind === 'model' ? e.model.name : e.helper.id))).toEqual(['e4b', 'e2b']);
    expect(groups[3].entries).toEqual([{ kind: 'helper', helper: helper({ id: 'camera_detector', title: 'YOLOX-Nano', uses: ['camera'] }) }]);
  });

  it('folds a picture encoder and a drafter into the model they serve, not rows of their own', () => {
    const encoder = helper({ id: 'gguf/e4b#pictures', serves: 'gguf/e4b' });
    const drafter = helper({ id: 'mtp-gemma-4-E4B-it', uses: ['drafter'], section: 'other', serves: 'gguf/e4b' });
    const faces = helper({ id: 'face_recognition', uses: ['faces'] });
    const groups = sectionsOnPond(
      [model({ name: 'e4b', section: 'conversation', roles: ['chat'] }), model({ name: 'e2b', section: 'conversation', roles: [] })],
      [encoder, drafter, faces],
    );
    expect(groups.map((g) => g.section)).toEqual(['conversation', 'pictures']);
    expect(groups[0].entries).toEqual([
      { kind: 'model', model: expect.objectContaining({ name: 'e4b' }), helpers: [encoder, drafter] },
      { kind: 'model', model: expect.objectContaining({ name: 'e2b' }), helpers: [] },
    ]);
    expect(groups[1].entries).toEqual([{ kind: 'helper', helper: faces }]);
  });

  it('lists a helper alone when the model it serves is not listed', () => {
    const encoder = helper({ id: 'gguf/gone#pictures', serves: 'gguf/gone' });
    expect(sectionsOnPond([], [encoder])).toEqual([{ section: 'pictures', entries: [{ kind: 'helper', helper: encoder }] }]);
  });

  it('finds the helpers that serve a model by the Pond’s id for it', () => {
    const encoder = helper({ id: 'enc', serves: 'tts_kokoro/af_heart' });
    expect(helpersOf(model({ category: 'tts', pond_category: 'tts_kokoro', name: 'af_heart' }), [encoder])).toEqual([encoder]);
    expect(helpersOf(model({ name: 'other' }), [encoder])).toEqual([]);
  });

  it('shows the memory model in use though the Pond fetched it itself and lists no file', () => {
    const groups = sectionsOnPond(
      [
        model({ category: 'embedding', name: 'all-MiniLM-L6-v2', downloaded: false, section: 'memory', roles: ['embedding'] }),
        model({ category: 'embedding', name: 'bge-small-en-v1.5', downloaded: false, section: 'memory', roles: [] }),
      ],
      [],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].section).toBe('memory');
    expect(groups[0].entries.map((e) => (e.kind === 'model' ? e.model.name : null))).toEqual(['all-MiniLM-L6-v2']);
  });

  it('puts a helper from a section this phone does not know under Other', () => {
    const groups = sectionsOnPond([], [helper({ section: 'reranking' as never })]);
    expect(groups.map((g) => g.section)).toEqual(['other']);
  });

  it('finds a job’s holder from the Pond’s roles', () => {
    const minilm = model({ category: 'embedding', name: 'minilm', active: false, roles: ['embedding'] });
    expect(holderOf([minilm], 'embedding')).toBe(minilm);
  });

  it('moves a job between rows before the Pond answers', () => {
    const held = model({ name: 'a', active: true, roles: ['chat', 'tool'] });
    expect(withRole(held, 'chat', false)).toMatchObject({ active: false, roles: ['tool'] });
    expect(withRole(model({ name: 'b', roles: [] }), 'chat', true)).toMatchObject({ active: true, roles: ['chat'] });
    expect(withRole(model({ name: 'c' }), 'chat', true).roles).toBeUndefined();
  });
});
