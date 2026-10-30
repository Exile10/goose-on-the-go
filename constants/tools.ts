/**
 * What Goose's tools are called when a person is watching.
 *
 * The Pond names a tool `extension__tool` — `giap-weather__get_current_weather`
 * — and has no display names of its own; pond-desktop keeps them client-side
 * (`ToolCallChip.tsx`, `chatRunStore.ts`), and these are its choices in this
 * app's sentence case. The key is the bare name after the `__`, because the
 * same tool can be served by a differently named extension.
 *
 * A tool nobody has named here is shown as its own name with the underscores
 * taken out. That is a raw identifier reaching the screen, which the app
 * otherwise refuses — but extensions are installed on the Pond, not in this
 * app, and a tool it has never heard of still did something worth showing.
 */

import type { IconName } from '@/constants/icons';
import type { ToolCall } from '@/models/chat';
import type { TranslationKey } from '@/services/i18n';

interface ToolWords {
  /** What the card is called. */
  label: TranslationKey;
  /** What Goose is doing while it runs, for the thinking line. */
  doing?: TranslationKey;
  icon: IconName;
}

const TOOLS: Record<string, ToolWords> = {
  // The Pond's own step: it loads a group of tools before the model may use them.
  enable_tool_group: { label: 'chat.tools.toolGroup', doing: 'chat.tools.doingToolGroup', icon: 'skills' },
  get_current_weather: { label: 'chat.tools.weather', doing: 'chat.tools.doingWeather', icon: 'sun' },
  get_weather_forecast: { label: 'chat.tools.forecast', doing: 'chat.tools.doingWeather', icon: 'partly-sunny' },
  get_wikipedia_article: { label: 'chat.tools.wikipedia', doing: 'chat.tools.doingLookup', icon: 'globe' },
  search_web: { label: 'chat.tools.webSearch', doing: 'chat.tools.doingWebSearch', icon: 'search' },
  compute_answer: { label: 'chat.tools.computed', doing: 'chat.tools.doingCompute', icon: 'sparkle' },
  list_schedules: { label: 'chat.tools.schedules', doing: 'chat.tools.doingSchedules', icon: 'schedule' },
  create_schedule: { label: 'chat.tools.createSchedule', icon: 'schedule' },
  delete_schedule: { label: 'chat.tools.deleteSchedule', icon: 'schedule' },
  pause_schedule: { label: 'chat.tools.pauseSchedule', icon: 'schedule' },
  resume_schedule: { label: 'chat.tools.resumeSchedule', icon: 'schedule' },
  run_schedule_now: { label: 'chat.tools.runSchedule', icon: 'schedule' },
  save_memory: { label: 'chat.tools.saveMemory', doing: 'chat.tools.doingSaveMemory', icon: 'memory' },
  recall_memories: { label: 'chat.tools.recallMemory', doing: 'chat.tools.doingRecall', icon: 'memory' },
  forget_memory: { label: 'chat.tools.forgetMemory', icon: 'memory' },
  get_system_info: { label: 'chat.tools.systemInfo', icon: 'cpu' },
  get_current_time: { label: 'chat.tools.currentTime', icon: 'schedule' },
  send_notification: { label: 'chat.tools.notification', icon: 'bell' },
  list_registered_devices: { label: 'chat.tools.devices', doing: 'chat.tools.doingDevices', icon: 'device' },
  get_device_state: { label: 'chat.tools.deviceState', doing: 'chat.tools.doingDevices', icon: 'device' },
  set_device_state: { label: 'chat.tools.setDevice', doing: 'chat.tools.doingSetDevice', icon: 'power' },
  get_current_profile: { label: 'chat.tools.profile', icon: 'profile' },
  get_user_profile: { label: 'chat.tools.profile', doing: 'chat.tools.doingProfile', icon: 'profile' },
  get_model_config: { label: 'chat.tools.modelConfig', icon: 'models' },
  list_skills: { label: 'chat.tools.skills', doing: 'chat.tools.doingSkills', icon: 'skills' },
  task_start: { label: 'chat.tools.taskStart', doing: 'chat.tools.doingTaskStart', icon: 'logs' },
  task_status: { label: 'chat.tools.taskStatus', doing: 'chat.tools.doingTaskStatus', icon: 'logs' },
  task_cancel: { label: 'chat.tools.taskCancel', icon: 'logs' },
  play: { label: 'chat.tools.playMusic', icon: 'music' },
  status: { label: 'chat.tools.nowPlaying', icon: 'music' },
  control: { label: 'chat.tools.playback', icon: 'music' },
};

/** `giap-weather__get_current_weather` → `get_current_weather`. */
export function bareToolName(name: string): string {
  const at = name.lastIndexOf('__');
  return at === -1 ? name : name.slice(at + 2);
}

/** `get_current_weather` → `Get current weather`: sentence case, as the app writes. */
export function humanizeTool(name: string): string {
  const words = bareToolName(name).replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

export function toolWords(name: string): ToolWords | undefined {
  return TOOLS[bareToolName(name)];
}

export function toolIcon(name: string): IconName {
  return toolWords(name)?.icon ?? 'skills';
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** A page a reply read from, as the list under the answer shows it. */
export interface Source {
  /** The page's own title when the tool gave one, otherwise its site. */
  title: string;
  /** The site as a person names it: "Wikipedia", not `en.wikipedia.org`. */
  site: string;
  url: string;
}

// Read off the text rather than through `URL`, whose getters React Native has not always had.
const WEB_HOST = /^https?:\/\/([^/?#:\s]+)/i;

/** Null for anything that is not a web page, which a source is never allowed to open. */
function siteOf(url: string): string | null {
  const host = WEB_HOST.exec(url)?.[1]?.toLowerCase().replace(/^www\./, '');
  if (!host) return null;
  // eslint-disable-next-line i18next/no-literal-string -- a product name
  if (/(^|\.)wikipedia\.org$/.test(host)) return 'Wikipedia';
  // eslint-disable-next-line i18next/no-literal-string -- a product name
  if (/(^|\.)wolframalpha\.com$/.test(host)) return 'Wolfram Alpha';
  return host;
}

/**
 * The pages a turn's tools read from, in the order it read them, once each.
 *
 * A web search lists its pages on its card. Wikipedia and Wolfram name one
 * source: live, on the card; in a saved turn whose card this phone never kept,
 * only as a closing `Source: <url>` line in the result.
 */
export function sourcesOf(tools: ToolCall[] | undefined): Source[] {
  const out: Source[] = [];
  const add = (url: string, title: string) => {
    const site = siteOf(url);
    if (!site || out.some((s) => s.url === url)) return;
    out.push({ url, site, title: title || site });
  };
  for (const tool of tools ?? []) {
    const data = tool.card?.data;
    if (tool.card?.type === 'search') {
      for (const hit of Array.isArray(data?.results) ? data.results : []) {
        if (hit && typeof hit === 'object') add(str(hit.url).trim(), str(hit.title).trim());
      }
      continue;
    }
    const fromCard = data ? str(data.source_url) : '';
    const fromText = /Source:\s*(https?:\/\/\S+)\s*$/i.exec(tool.result ?? '')?.[1] ?? '';
    const url = fromCard || fromText;
    if (url) add(url, data ? str(data.title) || str(data.primary_title) : '');
  }
  return out;
}
