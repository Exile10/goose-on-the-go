import {
  CORE_PROMPT_PRESETS,
  SAMPLE_PROMPT_TEMPLATES,
  sortTemplates,
  templateLabel,
} from '@/models/prompt-templates';
import type { PromptTemplate } from '@/services/types';

describe('prompt-templates model', () => {
  it('defines the core presets in expected order', () => {
    expect(CORE_PROMPT_PRESETS).toEqual([
      'soul',
      'heartbeat',
      'scratchpad',
      'balanced',
      'concise',
      'technical',
      'warm',
    ]);
  });

  it('formats labels nicely for known presets and custom keys', () => {
    expect(templateLabel('soul')).toBe('Soul');
    expect(templateLabel('heartbeat')).toBe('Heartbeat');
    expect(templateLabel('scratchpad')).toBe('Scratchpad');
    expect(templateLabel('my_custom_prompt')).toBe('My custom prompt');
  });

  it('sorts templates with core presets first followed by custom ones alphabetically', () => {
    const raw: PromptTemplate[] = [
      { name: 'warm', content: '', is_system: true },
      { name: 'zeta_custom', content: '', is_system: false },
      { name: 'soul', content: '', is_system: true },
      { name: 'alpha_custom', content: '', is_system: false },
      { name: 'heartbeat', content: '', is_system: true },
    ];

    const sorted = sortTemplates(raw);
    expect(sorted.map((t) => t.name)).toEqual([
      'soul',
      'heartbeat',
      'warm',
      'alpha_custom',
      'zeta_custom',
    ]);
  });

  it('provides complete sample fallback templates', () => {
    expect(SAMPLE_PROMPT_TEMPLATES.length).toBeGreaterThanOrEqual(7);
    const names = SAMPLE_PROMPT_TEMPLATES.map((t) => t.name);
    expect(names).toContain('soul');
    expect(names).toContain('heartbeat');
    expect(names).toContain('scratchpad');
  });
});
