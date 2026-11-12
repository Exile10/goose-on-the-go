/**
 * Agent prompt templates: view, edit, save, and reset core agent instructions
 * (soul, heartbeat, scratchpad, and prompt styles) via `GET/PUT /api/v1/prompts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SAMPLE_PROMPT_TEMPLATES, sortTemplates } from '@/models/prompt-templates';
import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import { confirm, reject } from '@/services/haptics';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import type { PromptTemplate } from '@/services/types';
import { describeApiError } from './describe-error';

export interface UsePromptTemplates {
  data: {
    templates: PromptTemplate[];
    activeName: string;
    activeTemplate: PromptTemplate | null;
    content: string;
    isDirty: boolean;
    isCustomized: boolean;
  };
  loading: boolean;
  saving: boolean;
  resetting: boolean;
  error: string | null;
  failed: boolean;
  actions: {
    refresh: () => Promise<void>;
    select: (name: string) => void;
    setContent: (content: string) => void;
    save: () => Promise<boolean>;
    reset: () => Promise<boolean>;
  };
}

export function usePromptTemplates(): UsePromptTemplates {
  const { hydrated, isScreenReal } = useServer();
  const real = isScreenReal('settings');

  const [templates, setTemplates] = useState<PromptTemplate[]>(() =>
    real ? [] : sortTemplates(SAMPLE_PROMPT_TEMPLATES),
  );
  const [activeName, setActiveName] = useState<string>('soul');
  const [draftContent, setDraftContent] = useState<string>('');
  const [loading, setLoading] = useState(real);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const activeTemplate = useMemo(() => {
    return templates.find((t) => t.name === activeName) ?? templates[0] ?? null;
  }, [templates, activeName]);

  const loaded = useRef(false);
  useEffect(() => {
    loaded.current = false;
  }, [real]);

  const load = useCallback(
    async (loud: boolean) => {
      if (!real) return;
      if (loud) {
        setLoading(true);
        setError(null);
      }
      try {
        const list = await api.listPromptTemplates();
        const sorted = sortTemplates(list);
        setTemplates(sorted);
        loaded.current = true;
        setError(null);
        setFailed(false);
      } catch (e) {
        if (loud || !loaded.current) setError(describeApiError(e));
        else console.warn('[prompt-templates] refresh failed', e instanceof ApiError ? e.status : 'network');
        if (!loaded.current) setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [real],
  );

  useEffect(() => {
    if (!hydrated) return;
    void load(true);
  }, [hydrated, load]);

  // Sync draftContent whenever activeTemplate changes (unless user actively editing)
  useEffect(() => {
    if (activeTemplate) {
      setDraftContent(activeTemplate.content);
    }
  }, [activeTemplate?.name, activeTemplate?.updated_at]);

  const select = useCallback(
    (name: string) => {
      setActiveName(name);
      const target = templates.find((t) => t.name === name);
      if (target) {
        setDraftContent(target.content);
      }
    },
    [templates],
  );

  const isDirty = useMemo(() => {
    return Boolean(activeTemplate && draftContent !== activeTemplate.content);
  }, [activeTemplate, draftContent]);

  const isCustomized = useMemo(() => {
    return Boolean(activeTemplate?.is_customized);
  }, [activeTemplate]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!activeTemplate) return false;
    setSaving(true);
    try {
      if (real) {
        const updated = await api.updatePromptTemplate(activeTemplate.name, draftContent);
        setTemplates((prev) =>
          sortTemplates(prev.map((t) => (t.name === updated.name ? updated : t))),
        );
      } else {
        setTemplates((prev) =>
          sortTemplates(
            prev.map((t) =>
              t.name === activeTemplate.name
                ? { ...t, content: draftContent, is_customized: true, updated_at: new Date().toISOString() }
                : t,
            ),
          ),
        );
      }
      void confirm();
      showSnackbar({ message: i18n.t('promptTemplates.savedToast'), tone: 'success' });
      return true;
    } catch (e) {
      void reject();
      showSnackbar({
        message: describeApiError(e) ?? i18n.t('errors.generic'),
        tone: 'danger',
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [activeTemplate, draftContent, real]);

  const reset = useCallback(async (): Promise<boolean> => {
    if (!activeTemplate) return false;
    setResetting(true);
    try {
      if (real) {
        const restored = await api.resetPromptTemplate(activeTemplate.name);
        setTemplates((prev) =>
          sortTemplates(prev.map((t) => (t.name === restored.name ? restored : t))),
        );
        setDraftContent(restored.content);
      } else {
        const sample = SAMPLE_PROMPT_TEMPLATES.find((t) => t.name === activeTemplate.name);
        if (sample) {
          setTemplates((prev) =>
            sortTemplates(
              prev.map((t) =>
                t.name === activeTemplate.name
                  ? { ...sample, is_customized: false, updated_at: new Date().toISOString() }
                  : t,
              ),
            ),
          );
          setDraftContent(sample.content);
        }
      }
      void confirm();
      showSnackbar({ message: i18n.t('promptTemplates.resetToast'), tone: 'success' });
      return true;
    } catch (e) {
      void reject();
      showSnackbar({
        message: describeApiError(e) ?? i18n.t('errors.generic'),
        tone: 'danger',
      });
      return false;
    } finally {
      setResetting(false);
    }
  }, [activeTemplate, real]);

  return {
    data: {
      templates,
      activeName: activeTemplate?.name ?? activeName,
      activeTemplate,
      content: draftContent,
      isDirty,
      isCustomized,
    },
    loading,
    saving,
    resetting,
    error,
    failed,
    actions: {
      refresh: () => load(true),
      select,
      setContent: setDraftContent,
      save,
      reset,
    },
  };
}
