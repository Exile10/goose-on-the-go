/**
 * The Pond's models, held once for the Models pages. Downloads are read every 1.5 s while one is
 * moving, as the desktop does; the rest changes on the Pond's schedule, so it is read rarely.
 */

import { useCallback, useState, useSyncExternalStore } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import { confirm, reject } from '@/services/haptics';
import i18n from '@/services/i18n';
import { Storage } from '@/services/storage';
import { showSnackbar } from '@/services/snackbar';
import type {
  DiskUsage,
  DownloadAction,
  DownloadEntry,
  HelperModel,
  HfModel,
  HfModelFile,
  ModelEntry,
  ModelMemoryStatus,
  ModelRole,
  ModelSection,
  ModelUse,
} from '@/services/types';
import { holderOf, isLive, roleOf, rollbackTarget, routeCategory, withRole } from '@/models/model-library';
import { describeApiError, logFailure } from './describe-error';
import { useLive } from './use-live';

const LIBRARY_MS = 60_000;
const MOVING_MS = 1_500;
const IDLE_DOWNLOADS_MS = 15_000;

interface Library {
  models: ModelEntry[];
  /** Models in use beside the catalogue rows: picture support, a drafter, the camera's. */
  helpers: HelperModel[];
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
  /** The model each job had before its last change, by id: what a switch back goes to. */
  lastWorking: Partial<Record<ModelRole, string>>;
}

const EMPTY: Library = {
  models: [],
  helpers: [],
  loaded: false,
  readFailed: false,
  error: null,
  downloads: [],
  disk: null,
  memory: null,
  busy: null,
  lastWorking: {},
};

let library: Library = EMPTY;
const listeners = new Set<() => void>();
let reads = 0;
let lastWorkingRead: Promise<void> | null = null;

function set(patch: Partial<Library>) {
  library = { ...library, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Read what this phone remembered from earlier sessions, once. A change made since wins. */
function readLastWorking(): Promise<void> {
  lastWorkingRead ??= Storage.getJSON<Library['lastWorking']>('lastWorkingModels')
    .then((saved) => {
      if (saved) set({ lastWorking: { ...saved, ...library.lastWorking } });
    })
    .catch(() => {
      // Nothing remembered: there is no switch back until the next change.
    });
  return lastWorkingRead;
}

function rememberLastWorking(role: ModelRole, id: string): void {
  const lastWorking = { ...library.lastWorking, [role]: id };
  set({ lastWorking });
  Storage.setJSON('lastWorkingModels', lastWorking).catch((e) => console.warn('[models] could not save the last working model', e));
}

async function loadModels(loud: boolean): Promise<void> {
  void readLastWorking();
  if (loud) set({ readFailed: false, error: null });
  const mine = ++reads;
  try {
    const [models, helpers, memory, disk] = await Promise.all([
      api.listModels(),
      api.helperModels().catch((e) => {
        logFailure('models', 'helper read failed; showing the last ones', e);
        return library.helpers;
      }),
      api.modelMemoryStatus().catch(() => library.memory),
      api.diskUsage().catch(() => library.disk),
    ]);
    if (mine !== reads) return;
    set({ models, helpers, memory, disk, loaded: true, readFailed: false, error: null });
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

/**
 * Say that a change did not take, at the foot of the screen, with Try again when trying again is
 * the same request. Every Models page and the setup step share this store, so the message has to
 * live outside any one of them; the engineer's half goes to the log.
 */
function refused(scope: string, e: unknown, text: string, retry?: () => void): void {
  logFailure('models', `${scope} failed`, e);
  showSnackbar({
    message: text,
    tone: 'danger',
    action: retry ? { label: i18n.t('common.retry'), onPress: retry } : undefined,
  });
}

async function activate(model: ModelEntry): Promise<boolean> {
  const role = roleOf(model);
  const previous = library.models;
  const before = holderOf(previous, role);
  set({
    busy: model.id,
    models: previous.map((m) => (roleOf(m) === role ? withRole(m, role, m.id === model.id) : m)),
  });
  try {
    await api.activateModel(routeCategory(model), model.name, role);
    void confirm();
    set({ busy: null });
    if (before && before.id !== model.id) rememberLastWorking(role, before.id);
    void loadModels(false);
    return true;
  } catch (e) {
    void reject();
    set({ busy: null, models: previous });
    refused('activate', e, failure(e, i18n.t('models.library.useFailed')), () => void activate(model));
    return false;
  }
}

/** Give a job back to the model it had before its last change. Doing it twice returns to where it started. */
async function rollBack(role: ModelRole): Promise<boolean> {
  const target = rollbackTarget(library.models, role, library.lastWorking[role]);
  return target ? activate(target) : false;
}

async function download(model: ModelEntry, pictures: boolean): Promise<void> {
  set({ busy: model.id });
  try {
    await api.downloadModel(routeCategory(model), model.name, pictures);
    set({ busy: null });
    await loadDownloads();
  } catch (e) {
    void reject();
    set({ busy: null });
    refused('download', e, failure(e, i18n.t('models.library.downloadFailed')), () => void download(model, pictures));
  }
}

async function addPictures(model: ModelEntry): Promise<void> {
  set({ busy: model.id });
  try {
    await api.addPictureSupport(routeCategory(model), model.name);
    set({ busy: null });
    await loadDownloads();
  } catch (e) {
    void reject();
    set({ busy: null });
    refused('add_pictures', e, failure(e, i18n.t('models.library.downloadFailed')), () => void addPictures(model));
  }
}

async function control(modelId: string, action: DownloadAction): Promise<void> {
  try {
    await api.controlDownload(modelId, action);
    await loadDownloads();
  } catch (e) {
    void reject();
    refused(`download_${action}`, e, failure(e, i18n.t('models.library.controlFailed')), () => void control(modelId, action));
  }
}

async function remove(model: ModelEntry): Promise<boolean> {
  set({ busy: model.id });
  try {
    await api.deleteModel(routeCategory(model), model.name);
    void confirm();
    set({ busy: null, models: library.models.map((m) => (m.id === model.id ? { ...m, downloaded: false, active: false } : m)) });
    void loadModels(false);
    return true;
  } catch (e) {
    void reject();
    set({ busy: null });
    // A model in use stays in use however often the same request is sent, so that one has no Try again.
    if (e instanceof ApiError && e.status === 409) refused('delete', e, i18n.t('models.library.inUse'));
    else refused('delete', e, failure(e, i18n.t('models.library.deleteFailed')), () => void remove(model));
    return false;
  }
}

async function downloadFile(file: HfModelFile, pictures: boolean): Promise<boolean> {
  try {
    await api.downloadModelFile(file, pictures);
    await loadDownloads();
    return true;
  } catch (e) {
    void reject();
    refused('download_file', e, failure(e, i18n.t('models.library.downloadFailed')), () => void downloadFile(file, pictures));
    return false;
  }
}

export interface UseModelLibrary extends Library {
  actions: {
    refresh: () => Promise<void>;
    activate: (model: ModelEntry) => Promise<boolean>;
    rollBack: (role: ModelRole) => Promise<boolean>;
    download: (model: ModelEntry, pictures: boolean) => Promise<void>;
    addPictures: (model: ModelEntry) => Promise<void>;
    control: (modelId: string, action: DownloadAction) => Promise<void>;
    remove: (model: ModelEntry) => Promise<boolean>;
    downloadFile: (file: HfModelFile, pictures: boolean) => Promise<boolean>;
  };
}

const ACTIONS: UseModelLibrary['actions'] = {
  refresh: () => loadModels(true),
  activate,
  rollBack,
  download,
  addPictures,
  control,
  remove,
  downloadFile,
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
  lastWorkingRead = null;
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

/** The name of a job, as a household reads it. */
export function roleLabelKey(role: ModelUse) {
  switch (role) {
    case 'chat':
      return 'models.library.role.chat' as const;
    case 'asr':
      return 'models.library.role.asr' as const;
    case 'tts':
      return 'models.library.role.tts' as const;
    case 'embedding':
      return 'models.library.role.embedding' as const;
    case 'tool':
      return 'models.library.role.tool' as const;
    case 'pictures':
      return 'models.library.role.pictures' as const;
    case 'drafter':
      return 'models.library.role.drafter' as const;
    case 'camera':
      return 'models.library.role.camera' as const;
    case 'faces':
      return 'models.library.role.faces' as const;
  }
}

/** What a model working beside a row adds to it, as the row reads: "Pictures included". */
export function includedKey(use: ModelUse) {
  switch (use) {
    case 'pictures':
      return 'models.library.included.pictures' as const;
    case 'drafter':
      return 'models.library.included.drafter' as const;
    default:
      return roleLabelKey(use);
  }
}

/** What a model working beside the rows does, for its own page. */
export function helperAboutKey(use: ModelUse) {
  switch (use) {
    case 'pictures':
      return 'models.library.helperAbout.pictures' as const;
    case 'drafter':
      return 'models.library.helperAbout.drafter' as const;
    case 'camera':
      return 'models.library.helperAbout.camera' as const;
    case 'faces':
      return 'models.library.helperAbout.faces' as const;
    default:
      return roleLabelKey(use);
  }
}

/** Who on the Pond relies on a model working beside the rows, for its own page. */
export function helperUsedByKey(use: ModelUse) {
  switch (use) {
    case 'camera':
      return 'models.library.usedBy.camera' as const;
    case 'faces':
      return 'models.library.usedBy.faces' as const;
    default:
      return 'models.library.usedBy.conversation' as const;
  }
}

/** The heading of a section of the Models page. */
export function sectionLabelKey(section: ModelSection) {
  switch (section) {
    case 'conversation':
      return 'models.library.section.conversation' as const;
    case 'listening':
      return 'models.library.section.listening' as const;
    case 'speaking':
      return 'models.library.section.speaking' as const;
    case 'memory':
      return 'models.library.section.memory' as const;
    case 'pictures':
      return 'models.library.section.pictures' as const;
    case 'other':
      return 'models.library.section.other' as const;
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
