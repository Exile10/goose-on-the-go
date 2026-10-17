/**
 * Choosing Goose's voice during setup, as pond-desktop's setup does it. The Pond lists no models
 * until setup is done, so the voices are the ones it has installed and Kokoro's catalogue.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/services/api-client';
import i18n from '@/services/i18n';
import { KNOWN_VOICES } from '@/models/pond-settings';
import { SETUP_VOICE_QUALITY, type SetupDraft } from '@/models/owner-setup';
import type { VoiceChoice } from './use-settings-extras';
import { describeApiError } from './describe-error';

export interface UseSetupVoice {
  voices: VoiceChoice[];
  loading: boolean;
  applying: boolean;
  error: string | null;
  choose: (id: string) => Promise<boolean>;
  setPace: (speed: number) => Promise<boolean>;
}

export function useSetupVoice(draft: SetupDraft, patch: (change: Partial<SetupDraft>) => void): UseSetupVoice {
  const [installed, setInstalled] = useState<ReadonlySet<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The tier in force is the Pond's answer, which can differ from the one asked for.
  const tier = useRef(SETUP_VOICE_QUALITY);
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    // The smallest tier first, as the desktop settles it, so the chat model keeps its memory.
    void api
      .applyTts({ quality: SETUP_VOICE_QUALITY })
      .then(async (r) => {
        if (cancelled) return;
        tier.current = r.quality || SETUP_VOICE_QUALITY;
        setInstalled(new Set(r.installed_voices));
        await api.updateSettings({ voice_tts_quality: tier.current });
      })
      .catch(() => {
        // No speech engine yet: the voice is still saved, and applied when the engine starts.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const chosen = draft.ttsVoice;
  const voices = useMemo(() => {
    const ids = [...new Set([...installed, ...KNOWN_VOICES, chosen])];
    return ids.map((id) => ({ id, installed: installed.has(id) }));
  }, [installed, chosen]);

  const choose = useCallback(
    async (id: string) => {
      const previous = latest.current.ttsVoice;
      patch({ ttsVoice: id });
      setApplying(true);
      setError(null);
      try {
        await api.updateSettings({ voice_tts_voice: id, voice_tts_speed: latest.current.ttsSpeed, voice_tts_quality: tier.current });
        const r = await api.applyTts({ voice: id, quality: tier.current });
        setInstalled(new Set(r.installed_voices));
        return true;
      } catch (e) {
        patch({ ttsVoice: previous });
        setError(describeApiError(e) ?? i18n.t('settings.voice.applyFailed'));
        return false;
      } finally {
        setApplying(false);
      }
    },
    [patch],
  );

  const setPace = useCallback(
    async (speed: number) => {
      const previous = latest.current.ttsSpeed;
      patch({ ttsSpeed: speed });
      setError(null);
      try {
        await api.updateSettings({ voice_tts_speed: speed });
        await api.applyTts({ speed, quality: tier.current });
        return true;
      } catch (e) {
        patch({ ttsSpeed: previous });
        setError(describeApiError(e) ?? i18n.t('settings.voice.applyFailed'));
        return false;
      }
    },
    [patch],
  );

  return { voices, loading, applying, error, choose, setPace };
}
