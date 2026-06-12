import { describe, expect, it } from 'vitest';

import { filterItems } from './filterable-list';

interface Guest {
  name: string;
  node: string;
  state: string;
}

const guests: Guest[] = [
  { name: 'Router', node: 'alpha', state: 'running' },
  { name: 'Archive', node: 'alpha', state: 'stopped' },
  { name: 'Dashboard', node: 'beta', state: 'running' },
];

describe('filterable list', () => {
  it('applies search and named filters through one interface', () => {
    const filtered = filterItems(
      guests,
      {
        search: (guest, query) => guest.name.toLowerCase().includes(query),
        filters: {
          node: (guest, value) => value === 'all' || guest.node === value,
          state: (guest, value) => value === 'all' || guest.state === value,
        },
      },
      'dash',
      { node: 'beta', state: 'running' },
    );

    expect(filtered).toEqual([{ name: 'Dashboard', node: 'beta', state: 'running' }]);
  });

  it('lets all-valued filters pass through', () => {
    expect(
      filterItems(
        guests,
        {
          filters: {
            node: (guest, value) => value === 'all' || guest.node === value,
          },
        },
        '',
        { node: 'all' },
      ),
    ).toHaveLength(3);
  });
});
