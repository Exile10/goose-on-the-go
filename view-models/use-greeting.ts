/**
 * Who a new conversation greets.
 *
 * The same person Home greets, from the same place: the first profile's
 * display name, which is how the household wrote it ("Jerry"). pond-desktop
 * reads `user_name` from `GET /settings` instead, and that is the fallback
 * here — but it is a setup field, often typed in lower case, and the phone's
 * two greetings disagreeing about the name is worse than either spelling.
 *
 * No name at all is a greeting without one. A greeting that invented a name,
 * or used "there", would be the app claiming to know someone it does not.
 */

import { useEffect, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';

/** The name someone is called, not their full record. */
function firstName(name: string | null | undefined): string | null {
  return name?.trim().split(/\s+/)[0] || null;
}

export function useGreetingName(): string | null {
  const { hydrated } = useServer();
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    let live = true;
    void (async () => {
      let found: string | null = null;
      try {
        found = firstName((await api.listProfiles())[0]?.display_name);
      } catch {
        // Fall through to the settings name.
      }
      if (!found) {
        try {
          found = firstName(await api.userName());
        } catch {
          // No name is a greeting without one, not an error.
        }
      }
      if (live) setName(found);
    })();
    return () => {
      live = false;
    };
  }, [hydrated]);

  return name;
}
