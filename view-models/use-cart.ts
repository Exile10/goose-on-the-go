// The cart: links the member asked Goose to watch for price and stock, beside the listings they
// kept (docs/MY-GOOSE-HUB.md, part 4). Kept listings come from the saved cards, as before.

import { useCallback, useMemo } from 'react';

import { linkFromPaste, type CartItem, type CartNotify } from '@/models/cart';
import type { Money } from '@/models/me-read';
import { cartsFrom } from '@/models/my-goose';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import { hubAction, useHubRead } from './hub-read';
import { useSavedItems } from './use-saved-items';

/** While a link is first read the cart is read every few seconds; otherwise a few times an hour. */
export const CART_CHECKING_MS = 5_000;
export const CART_MS = 10 * 60_000;

export function useCart(enabled = true) {
  const cart = useHubRead<CartItem[]>('cart', (s) => s.cart(), [], (items) => (items.some((i) => i.status === 'checking') ? CART_CHECKING_MS : CART_MS), enabled);
  const saved = useSavedItems();
  const kept = useMemo(() => cartsFrom(saved.data.items), [saved.data.items]);
  const { source, setData } = cart;

  const put = useCallback((item: CartItem) => setData((items) => (items.some((i) => i.id === item.id) ? items.map((i) => (i.id === item.id ? item : i)) : [item, ...items])), [setData]);

  /** Watch a pasted link. Null when the paste held no link, which the field says itself. */
  const watch = useCallback(
    async (pasted: string, target: Money | null) => {
      const url = linkFromPaste(pasted);
      if (!url) return null;
      const made = await hubAction('cart', () => source.addToCart({ url, ...(target ? { target } : {}) }));
      if (!made) return null;
      put(made);
      showSnackbar({ message: i18n.t('goose.cart.watching'), tone: 'success' });
      return made;
    },
    [put, source],
  );

  const check = useCallback(
    async (id: string) => {
      const done = await hubAction('cart', () => source.checkCartItem(id), { retry: true });
      if (done) put(done);
      return done;
    },
    [put, source],
  );

  const edit = useCallback(
    async (id: string, change: { target?: Money | null; notify?: CartNotify; everyHours?: number }) => {
      const body = {
        ...(change.target !== undefined ? { target: change.target } : {}),
        ...(change.notify !== undefined ? { notify: change.notify } : {}),
        ...(change.everyHours !== undefined ? { every_hours: change.everyHours } : {}),
      };
      const done = await hubAction('cart', () => source.editCartItem(id, body));
      if (done) put(done);
      return done;
    },
    [put, source],
  );

  const stop = useCallback(
    async (id: string) => {
      const done = await hubAction('cart', () => source.deleteCartItem(id));
      if (done === null) return false;
      setData((items) => items.filter((i) => i.id !== id));
      showSnackbar({ message: i18n.t('goose.cart.stopped'), tone: 'success' });
      return true;
    },
    [setData, source],
  );

  return {
    ...cart,
    kept,
    keptFailed: saved.error !== null && saved.data.items.length === 0,
    actions: {
      reload: async () => {
        await Promise.all([cart.reload(), saved.actions.refresh()]);
      },
      watch,
      check,
      edit,
      stop,
    },
  };
}

export type UseCart = ReturnType<typeof useCart>;
