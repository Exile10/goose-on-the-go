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
  get_wikipedia_article: { label: 'chat.tools.wikipedia', doing: 'chat.tools.doingLookup', icon: 'globe' },
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

/**
 * The pages a turn's tools read from, for the chips under the answer.
 *
 * Only Wikipedia and Wolfram name their source. Live, it is on the card; in a
 * saved turn it survives only as a closing `Source: <url>` line in the result.
 */
export function sourcesOf(tools: ToolCall[] | undefined): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  for (const tool of tools ?? []) {
    const fromCard = tool.card ? str(tool.card.data.source_url) : '';
    const fromText = /Source:\s*(https?:\/\/\S+)\s*$/i.exec(tool.result ?? '')?.[1] ?? '';
    const url = fromCard || fromText;
    if (!url || out.some((s) => s.url === url)) continue;
    let label = url;
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      label = /(^|\.)wikipedia\.org$/.test(host)
        ? 'Wikipedia'
        : /(^|\.)wolframalpha\.com$/.test(host)
          ? 'Wolfram Alpha'
          : host;
    } catch {
      // Not a URL a browser would open either; show it as written.
    }
    out.push({ label, url });
  }
  return out;
}
