/**
 * What owner setup leaves for later, as a card on Home: the wake word, which needs a quiet room and
 * five takes, and a look over the defaults setup chose. Kept per pairing, and only on the phone that
 * set the Pond up; a phone that joins later has nothing left to finish.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { useServer } from '@/providers/server-provider';
import { storageFamily } from '@/services/storage';

export type ChecklistItem = 'wake' | 'review';

const ITEMS: readonly ChecklistItem[] = ['wake', 'review'];
const family = storageFamily('setupChecklist');

interface Held {
  profileId: string;
  open: ChecklistItem[];
}

let held: Held = { profileId: '', open: [] };
const listeners = new Set<() => void>();

function set(next: Held) {
  held = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called the moment setup finishes on this phone. */
export async function openSetupChecklist(profileId: string): Promise<void> {
  set({ profileId, open: [...ITEMS] });
  await family.setJSON(profileId, { open: ITEMS });
}

async function close(profileId: string, items: readonly ChecklistItem[]): Promise<void> {
  const open = (held.profileId === profileId ? held.open : []).filter((i) => !items.includes(i));
  set({ profileId, open });
  await (open.length > 0 ? family.setJSON(profileId, { open }) : family.remove([profileId]));
}

/** Mark one item done, from wherever it was done. */
export function finishChecklistItem(profileId: string, item: ChecklistItem): Promise<void> {
  return close(profileId, [item]);
}

export interface UseSetupChecklist {
  items: ChecklistItem[];
  actions: { done: (item: ChecklistItem) => void; dismiss: () => void };
}

export function useSetupChecklist(): UseSetupChecklist {
  const { profileId } = useServer();
  const snap = useSyncExternalStore(subscribe, () => held);

  useEffect(() => {
    if (!profileId || held.profileId === profileId) return;
    let live = true;
    void family
      .getJSON<{ open?: unknown }>(profileId)
      .then((saved) => {
        if (!live) return;
        const open = Array.isArray(saved?.open) ? ITEMS.filter((i) => (saved.open as unknown[]).includes(i)) : [];
        set({ profileId, open });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [profileId]);

  const done = useCallback((item: ChecklistItem) => void close(profileId, [item]), [profileId]);
  const dismiss = useCallback(() => void close(profileId, ITEMS), [profileId]);

  return { items: snap.profileId === profileId ? snap.open : [], actions: { done, dismiss } };
}

/** For tests: forget everything held. */
export function resetSetupChecklist(): void {
  held = { profileId: '', open: [] };
  listeners.forEach((l) => l());
}
