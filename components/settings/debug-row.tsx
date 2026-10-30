/**
 * The way into the Debug screen (issue #165), on the Advanced page of a Jarida test Pond only.
 *
 * The Pond is asked each time the page opens, because the same phone may be paired to a home
 * Pond tomorrow. Until it answers, and on any Pond that is not a test Pond, nothing is drawn:
 * a household never sees a row it could not use.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/services/api-client';
import { SettingsGroup, SettingsRow, TILE_INSET } from './settings-list';

export function DebugScreenGroup({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const [testPond, setTestPond] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .developerDebug()
      .then((state) => {
        if (live) setTestPond(state.test_pond);
      })
      // A Pond from before developer mode answers 404: no row, which is the right answer.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!testPond) return null;
  return (
    <SettingsGroup inset={TILE_INSET}>
      <SettingsRow label={t('screens.debug')} icon="cpu" tile="slate" accessory="next" onPress={onOpen} />
    </SettingsGroup>
  );
}
