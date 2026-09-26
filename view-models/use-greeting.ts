/**
 * Who a new conversation greets.
 *
 * The same person Home greets, from the same place: the household member
 * this device belongs to (`readMember`), by the display name the household
 * wrote ("Jerry"). pond-desktop reads `user_name` from `GET /settings`
 * instead, and that is the fallback here, but it is a setup field, often typed
 * in lower case, and the phone's two greetings disagreeing about the name is
 * worse than either spelling.
 *
 * No name at all is a greeting without one. A greeting that invented a name,
 * or used "there", would be the app claiming to know someone it does not.
 */

import { useEffect, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';
import { readMember } from './use-household';

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
      // Never rejects: a failed or unsupported read is no member, and falls
      // through to the settings name.
      let found = firstName((await readMember())?.displayName);
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
