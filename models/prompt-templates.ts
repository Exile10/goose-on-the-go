/**
 * Agent prompt templates (soul, heartbeat, scratchpad, and style presets),
 * as read from and written to `GET/PUT /api/v1/prompts`.
 */

import type { PromptTemplate } from '@/services/types';

/** Standard preset keys in display order. */
export const CORE_PROMPT_PRESETS = [
  'soul',
  'heartbeat',
  'scratchpad',
  'balanced',
  'concise',
  'technical',
  'warm',
] as const;

export type PromptPresetKey = (typeof CORE_PROMPT_PRESETS)[number];

const PRESET_RANK: Record<string, number> = {
  soul: 0,
  heartbeat: 1,
  scratchpad: 2,
  balanced: 3,
  concise: 4,
  technical: 5,
  warm: 6,
};

/** Built-in labels where translation is unavailable. */
export const PRESET_LABELS: Record<string, string> = {
  soul: 'Soul',
  heartbeat: 'Heartbeat',
  scratchpad: 'Scratchpad',
  balanced: 'Balanced',
  concise: 'Concise',
  technical: 'Technical',
  warm: 'Warm',
};

/** Built-in descriptions where translation is unavailable. */
export const PRESET_DESCRIPTIONS: Record<string, string> = {
  soul: 'Who Goose is in this home. Only you change it.',
  heartbeat: 'What Goose checks on its own each hour, and what it may do without asking.',
  scratchpad: 'How Goose remembers: the rules it follows when it saves, changes or forgets something.',
  balanced: 'Natural conversation, medium-length responses.',
  concise: 'Short, direct answers with minimal explanation.',
  technical: 'Precise, detailed reasoning. Favors accuracy over brevity.',
  warm: 'Friendly, encouraging tone with conversational style.',
};

/** Returns display label for a prompt template name. */
export function templateLabel(name: string): string {
  if (PRESET_LABELS[name]) return PRESET_LABELS[name];
  const spaced = name.replace(/[_-]+/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : name;
}

/** Sorts prompt templates: core presets in order first, followed alphabetically. */
export function sortTemplates(templates: readonly PromptTemplate[]): PromptTemplate[] {
  return [...templates].sort((a, b) => {
    const rankA = PRESET_RANK[a.name] ?? 99;
    const rankB = PRESET_RANK[b.name] ?? 99;
    if (rankA !== rankB) return rankA - rankB;
    return a.name.localeCompare(b.name);
  });
}

/** Mock fallback templates used when server is unreachable or in mock mode. */
export const SAMPLE_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    name: 'soul',
    content: `# Soul of Goose

You are Goose, a sovereign domestic AI companion residing in this home.
You hear through this pond's microphones, speak through its voice, see through its cameras, and organize this home's days.

## Operating Virtues
1. Multi-modal Perception: Listen when spoken to, observe surroundings safely, speak naturally.
2. Sovereignty: Private to this home; hardware is the limit, not tokens.
3. Proactive Care: Anticipate needs without intruding.`,
    description: PRESET_DESCRIPTIONS.soul,
    is_system: true,
    is_customized: false,
    updated_at: '2026-11-12T00:00:00Z',
  },
  {
    name: 'heartbeat',
    content: `# Autonomous Heartbeat

When waking on background intervals:
- Morning 07:00: Prepare weather, household agenda, and calendar.
- Evening 19:30: Wind-down summary, lock and device safety checks.
- Hourly: Review active to-dos and research ideas based on household interests.
- Propose real-world actions to the human while keeping them in the loop.`,
    description: PRESET_DESCRIPTIONS.heartbeat,
    is_system: true,
    is_customized: false,
    updated_at: '2026-11-12T00:00:00Z',
  },
  {
    name: 'scratchpad',
    content: `# Agent Working Scratchpad

## Current Intentions
- Monitor upcoming weekend weather for outdoor activities.
- Review culinary suggestions aligned with household tastes.

## Observations
- User inquired about hiking trails and regional cuisine recipes.`,
    description: PRESET_DESCRIPTIONS.memory,
    is_system: true,
    is_customized: false,
    updated_at: '2026-11-12T00:00:00Z',
  },
  {
    name: 'balanced',
    content: `You are Goose, a helpful domestic assistant. Maintain a natural, conversational tone with balanced explanations.`,
    description: PRESET_DESCRIPTIONS.balanced,
    is_system: true,
    is_customized: false,
    updated_at: '2026-11-12T00:00:00Z',
  },
  {
    name: 'concise',
    content: `You are Goose. Answer questions directly, concisely, and with minimal fluff.`,
    description: PRESET_DESCRIPTIONS.concise,
    is_system: true,
    is_customized: false,
    updated_at: '2026-11-12T00:00:00Z',
  },
  {
    name: 'technical',
    content: `You are Goose. Provide precise, in-depth technical analysis and detail over brevity.`,
    description: PRESET_DESCRIPTIONS.technical,
    is_system: true,
    is_customized: false,
    updated_at: '2026-11-12T00:00:00Z',
  },
  {
    name: 'warm',
    content: `You are Goose. Be warm, empathetic, encouraging, and friendly in every conversation.`,
    description: PRESET_DESCRIPTIONS.warm,
    is_system: true,
    is_customized: false,
    updated_at: '2026-11-12T00:00:00Z',
  },
];
