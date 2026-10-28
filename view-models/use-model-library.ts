/**
 * The Pond's models, held once for the Models pages. Downloads are read every 1.5 s while one is
 * moving, as the desktop does; the rest changes on the Pond's schedule, so it is read rarely.
 */

import { useCallback, useState, useSyncExternalStore } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import { confirm, reject } from '@/services/haptics';
import i18n from '@/services/i18n';
import type {
  DiskUsage,
  DownloadAction,
  DownloadEntry,
  HfModel,
  HfModelFile,
  ModelEntry,
  ModelMemoryStatus,
  ModelRole,
} from '@/services/types';
import { isLive, roleOf, routeCategory } from '@/models/model-library';
import { describeApiError, logFailure } from './describe-error';
import { useLive } from './use-live';

const LIBRARY_MS = 60_000;
const MOVING_MS = 1_500;
const IDLE_DOWNLOADS_MS = 15_000;

interface Library {
  models: ModelEntry[];
  loaded: boolean;
  /** The first read, or the last one somebody asked for, failed. */
  readFailed: boolean;
  /** Words for that failure, when there are any beyond the shared ones. */
  error: string | null;
  downloads: DownloadEntry[];
  disk: DiskUsage | null;
  memory: ModelMemoryStatus | null;
  /** The model a change is being made to, so its row can say so. */
  busy: string | null;
  notice: { tone: 'neutral' | 'danger'; text: string } | null;
}

const EMPTY: Library = {
  models: [],
  loaded: false,
  readFailed: false,
  error: null,
  downloads: [],
  disk: null,
  memory: null,
  busy: null,
  notice: null,
};

let library: Library = EMPTY;
const listeners = new Set<() => void>();
let reads = 0;

function set(patch: Partial<Library>) {
  library = { ...library, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function loadModels(loud: boolean): Promise<void> {
  if (loud) set({ readFailed: false, error: null });
  const mine = ++reads;
  try {
    const [models, memory, disk] = await Promise.all([
      api.listModels(),
      api.modelMemoryStatus().catch(() => library.memory),
      api.diskUsage().catch(() => library.disk),
    ]);
    if (mine !== reads) return;
    set({ models, memory, disk, loaded: true, readFailed: false, error: null });
  } catch (e) {
    if (mine !== reads) return;
    const said = loud || !library.loaded;
    logFailure('models', said ? 'read failed' : 'refresh failed; showing the last list', e);
    if (said) set({ readFailed: true, error: describeApiError(e) });
  }
}

async function loadDownloads(): Promise<void> {
  try {
    const downloads = await api.downloadProgress();
    const finished = library.downloads.some(isLive) && !downloads.some(isLive);
    set({ downloads });
    // A download that just finished changes what is on the Pond.
    if (finished) void loadModels(false);
  } catch {
    // The list is still what it was; the next read will say more.
  }
}

function failure(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.detail) return e.detail;
  return describeApiError(e) ?? fallback;
}

async function activate(model: ModelEntry): Promise<boolean> {
  const role = roleOf(model);
  const previous = library.models;
  set({
    busy: model.id,
    notice: null,
    models: previous.map((m) => (roleOf(m) === role ? { ...m, active: m.id === model.id } : m)),
  });
  try {
    await api.activateModel(routeCategory(model), model.name, role);
    void confirm();
    set({ busy: null });
    void loadModels(false);
    return true;
  } catch (e) {
    void reject();
    set({ busy: null, models: previous, notice: { tone: 'danger', text: failure(e, i18n.t('models.library.useFailed')) } });
    return false;
  }
}

async function download(model: ModelEntry, pictures: boolean): Promise<void> {
  set({ busy: model.id, notice: null });
  try {
    await api.downloadModel(routeCategory(model), model.name, pictures);
    set({ busy: null });
    await loadDownloads();
  } catch (e) {
    void reject();
    set({ busy: null, notice: { tone: 'danger', text: failure(e, i18n.t('models.library.downloadFailed')) } });
  }
}

async function addPictures(model: ModelEntry): Promise<void> {
  set({ busy: model.id, notice: null });
  try {
    await api.addPictureSupport(routeCategory(model), model.name);
    set({ busy: null });
    await loadDownloads();
  } catch (e) {
    void reject();
    set({ busy: null, notice: { tone: 'danger', text: failure(e, i18n.t('models.library.downloadFailed')) } });
  }
}

async function control(modelId: string, action: DownloadAction): Promise<void> {
  try {
    await api.controlDownload(modelId, action);
    await loadDownloads();
  } catch (e) {
    void reject();
    set({ notice: { tone: 'danger', text: failure(e, i18n.t('models.library.controlFailed')) } });
  }
}

async function remove(model: ModelEntry): Promise<boolean> {
  set({ busy: model.id, notice: null });
  try {
    await api.deleteModel(routeCategory(model), model.name);
    void confirm();
    set({ busy: null, models: library.models.map((m) => (m.id === model.id ? { ...m, downloaded: false, active: false } : m)) });
    void loadModels(false);
    return true;
  } catch (e) {
    void reject();
    const text = e instanceof ApiError && e.status === 409 ? i18n.t('models.library.inUse') : failure(e, i18n.t('models.library.deleteFailed'));
    set({ busy: null, notice: { tone: 'danger', text } });
    return false;
  }
}

async function downloadFile(file: HfModelFile, pictures: boolean): Promise<boolean> {
  set({ notice: null });
  try {
    await api.downloadModelFile(file, pictures);
    await loadDownloads();
    return true;
  } catch (e) {
    void reject();
    set({ notice: { tone: 'danger', text: failure(e, i18n.t('models.library.downloadFailed')) } });
    return false;
  }
}

export interface UseModelLibrary extends Library {
  actions: {
    refresh: () => Promise<void>;
    activate: (model: ModelEntry) => Promise<boolean>;
    download: (model: ModelEntry, pictures: boolean) => Promise<void>;
    addPictures: (model: ModelEntry) => Promise<void>;
    control: (modelId: string, action: DownloadAction) => Promise<void>;
    remove: (model: ModelEntry) => Promise<boolean>;
    downloadFile: (file: HfModelFile, pictures: boolean) => Promise<boolean>;
    dismissNotice: () => void;
  };
}

const ACTIONS: UseModelLibrary['actions'] = {
  refresh: () => loadModels(true),
  activate,
  download,
  addPictures,
  control,
  remove,
  downloadFile,
  dismissNotice: () => set({ notice: null }),
};

export function useModelLibrary(): UseModelLibrary {
  const { hydrated } = useServer();
  const snap = useSyncExternalStore(subscribe, () => library);
  useLive(() => loadModels(false), LIBRARY_MS, hydrated);
  useLive(loadDownloads, () => (library.downloads.some(isLive) ? MOVING_MS : IDLE_DOWNLOADS_MS), hydrated);
  return { ...snap, actions: ACTIONS };
}

/** For tests: forget everything held. */
export function resetModelLibrary(): void {
  library = EMPTY;
  reads = 0;
  listeners.forEach((l) => l());
}

export interface UseModelSearch {
  query: string;
  results: HfModel[];
  searching: boolean;
  error: string | null;
  files: { repo: string; items: HfModelFile[]; loading: boolean; error: string | null } | null;
  actions: {
    setQuery: (q: string) => void;
    search: () => Promise<void>;
    openRepo: (repo: string) => Promise<void>;
    closeRepo: () => void;
  };
}

/** Searching Hugging Face through the Pond, and listing one repository's files. */
export function useModelSearch(): UseModelSearch {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HfModel[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<UseModelSearch['files']>(null);

  const search = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    setFiles(null);
    try {
      setResults(await api.searchModels(q));
    } catch (e) {
      logFailure('models', 'search failed', e);
      setError(describeApiError(e) ?? i18n.t('models.library.searchFailed'));
    } finally {
      setSearching(false);
    }
  }, [query]);

  const openRepo = useCallback(async (repo: string) => {
    setFiles({ repo, items: [], loading: true, error: null });
    try {
      const items = await api.modelFiles(repo);
      setFiles({ repo, items, loading: false, error: null });
    } catch (e) {
      logFailure('models', 'file list failed', e);
      setFiles({ repo, items: [], loading: false, error: describeApiError(e) ?? i18n.t('models.library.searchFailed') });
    }
  }, []);

  return {
    query,
    results,
    searching,
    error,
    files,
    actions: { setQuery, search, openRepo, closeRepo: () => setFiles(null) },
  };
}

/** The role names for the Activity of choosing a model, as a household reads the jobs. */
export function roleLabelKey(role: ModelRole) {
  switch (role) {
    case 'chat':
      return 'models.library.role.chat' as const;
    case 'asr':
      return 'models.library.role.asr' as const;
    case 'tts':
      return 'models.library.role.tts' as const;
    case 'embedding':
      return 'models.library.role.embedding' as const;
  }
}

/** What each job is for, in a sentence, for the top of its page. */
export function roleAboutKey(role: ModelRole) {
  switch (role) {
    case 'chat':
      return 'models.library.roleAbout.chat' as const;
    case 'asr':
      return 'models.library.roleAbout.asr' as const;
    case 'tts':
      return 'models.library.roleAbout.tts' as const;
    case 'embedding':
      return 'models.library.roleAbout.embedding' as const;
  }
}
