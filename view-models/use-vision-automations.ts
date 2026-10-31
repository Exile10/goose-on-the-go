/**
 * Vision automations: the rules that listen to a camera, and starters the household can add in a
 * tap, built from what the pond is watching for and who it knows by face.
 *
 * The rules themselves are `useRules`' business, with its polling, mock mode and the whole-rule
 * replace that `PUT /rules/{id}` needs; this narrows them to the camera's and offers the rest.
 * A starter is offered only when the pond would ever produce its signal, and only once the
 * settings and the faces have been read, so nothing flashes in and then goes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildStarters, cameraRules, peopleBlock, type PeopleBlock, type Starter } from '@/models/vision';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import type { Rule, RuleRequest } from '@/services/types';
import { useFaces } from './use-faces';
import { usePondSettings } from './use-pond-settings';
import { useRules } from './use-rules';

export interface UseVisionAutomations {
  data: {
    /** The rules that listen to a camera. */
    rules: Rule[];
    starters: Starter[];
    /** Why no starter about a person is offered, or null when one is. */
    peopleBlock: PeopleBlock;
    nameOf: (profileId: string) => string | null;
  };
  loading: boolean;
  error: string | null;
  failed: boolean;
  /** Starter ids with an add on its way to the Pond. A refusal is said in the snackbar. */
  adding: ReadonlySet<string>;
  actions: {
    refresh: () => Promise<void>;
    /** One tap: resolves to whether the Pond kept it. */
    add: (starter: Starter) => Promise<boolean>;
    create: (req: RuleRequest) => Promise<string | null>;
    update: (rule: Rule, req: RuleRequest) => Promise<string | null>;
    remove: (rule: Rule) => Promise<string | null>;
    setPaused: (rule: Rule, paused: boolean) => Promise<void>;
  };
}

export function useVisionAutomations(): UseVisionAutomations {
  const rules = useRules();
  const faces = useFaces();
  const settings = usePondSettings();
  const [adding, setAdding] = useState<ReadonlySet<string>>(() => new Set());
  // What the snackbar's Try again calls: the current `add`, set below once it is made.
  const retry = useRef<(starter: Starter) => Promise<boolean>>(async () => false);

  const mine = useMemo(() => cameraRules(rules.data.rules), [rules.data.rules]);
  const s = settings.settings;
  // Not offered before the settings and the faces are known: a starter that flashes in and goes
  // is a promise the screen then breaks.
  const known = s !== null && !faces.loading && !faces.failed && !rules.loading;

  const inputs = useMemo(
    () => ({
      people: faces.data.people,
      watched: s?.vision_event_types ?? [],
      faceRecognition: s?.vision_face_recognition_enabled ?? true,
      facesAvailable: faces.data.available,
      rules: mine,
    }),
    [faces.data.people, faces.data.available, s?.vision_event_types, s?.vision_face_recognition_enabled, mine],
  );

  const starters = useMemo(() => (known ? buildStarters(inputs) : []), [known, inputs]);
  const block = known ? peopleBlock(inputs) : null;

  const { create } = rules.actions;
  const add = useCallback(
    async (starter: Starter) => {
      setAdding((current) => new Set(current).add(starter.id));
      const refused = await create(starter.request);
      setAdding((current) => {
        const next = new Set(current);
        next.delete(starter.id);
        return next;
      });
      if (refused !== null) {
        showSnackbar({
          message: refused || i18n.t('visionAutomations.addFailed'),
          tone: 'danger',
          action: { label: i18n.t('common.retry'), onPress: () => void retry.current(starter) },
        });
      }
      return refused === null;
    },
    [create],
  );
  useEffect(() => {
    retry.current = add;
  }, [add]);

  return {
    data: { rules: mine, starters, peopleBlock: block, nameOf: faces.nameOf },
    loading: rules.loading,
    error: rules.error,
    failed: rules.failed,
    adding,
    actions: { ...rules.actions, add },
  };
}
