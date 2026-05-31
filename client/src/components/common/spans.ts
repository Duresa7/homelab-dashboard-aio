/**
 * Responsive column spans against the 12-column page grid.
 * Mirrors the span map in components/tile/Tile.tsx so cards line up with tiles.
 */
export const SPAN_CLASS: Record<number, string> = {
  2: 'col-span-12 sm:col-span-6 lg:col-span-2',
  3: 'col-span-12 sm:col-span-6 lg:col-span-3',
  4: 'col-span-12 sm:col-span-6 lg:col-span-4',
  5: 'col-span-12 lg:col-span-5',
  6: 'col-span-12 lg:col-span-6',
  7: 'col-span-12 lg:col-span-7',
  8: 'col-span-12 lg:col-span-8',
  9: 'col-span-12 lg:col-span-9',
  12: 'col-span-12',
};

export function spanClass(span = 12): string {
  return SPAN_CLASS[span] ?? SPAN_CLASS[12];
}
