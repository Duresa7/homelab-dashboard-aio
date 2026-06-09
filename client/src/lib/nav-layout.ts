import { useEffect, useState } from 'react';

import { getState, setState, subscribe as subscribeState } from './store';

/**
 * Primary navigation layout: the collapsible sidebar (default) or a
 * traditional horizontal bar under the topbar. Persisted via /api/state.
 */
export type NavLayout = 'sidebar' | 'topbar';

const STORAGE_KEY = 'navLayout';
export const DEFAULT_NAV_LAYOUT: NavLayout = 'sidebar';

export const NAV_LAYOUT_OPTIONS: { value: NavLayout; label: string }[] = [
  { value: 'sidebar', label: 'Sidebar' },
  { value: 'topbar', label: 'Top bar' },
];

function normalize(value: unknown): NavLayout {
  return value === 'topbar' ? 'topbar' : DEFAULT_NAV_LAYOUT;
}

export function getNavLayout(): NavLayout {
  return normalize(getState<unknown>(STORAGE_KEY, DEFAULT_NAV_LAYOUT));
}

export function setNavLayout(layout: NavLayout): void {
  setState<NavLayout>(STORAGE_KEY, layout);
}

export function useNavLayout(): NavLayout {
  const [layout, setLayout] = useState<NavLayout>(getNavLayout);
  useEffect(() => subscribeState(STORAGE_KEY, () => setLayout(getNavLayout())), []);
  return layout;
}
