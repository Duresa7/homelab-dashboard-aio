import { useCallback, useMemo, useState } from 'react';

export type FilterValues = Record<string, string>;

export interface FilterableListConfig<T> {
  initialFilters?: FilterValues;
  search?: (item: T, query: string) => boolean;
  filters?: Record<string, (item: T, value: string) => boolean>;
}

export interface FilterableList<T> {
  query: string;
  setQuery: (query: string) => void;
  filters: FilterValues;
  setFilter: (key: string, value: string) => void;
  filtered: T[];
  total: number;
}

export function filterItems<T>(
  items: T[],
  config: FilterableListConfig<T>,
  query: string,
  values: FilterValues,
): T[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (q && config.search && !config.search(item, q)) return false;
    for (const [key, value] of Object.entries(values)) {
      const predicate = config.filters?.[key];
      if (predicate && !predicate(item, value)) return false;
    }
    return true;
  });
}

export function useFilterableList<T>(
  items: T[],
  config: FilterableListConfig<T>,
): FilterableList<T> {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<FilterValues>(() => config.initialFilters ?? {});

  const setFilter = useCallback((key: string, value: string) => {
    setFilters((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);

  const filtered = useMemo(
    () => filterItems(items, config, query, filters),
    [items, config, query, filters],
  );

  return { query, setQuery, filters, setFilter, filtered, total: items.length };
}
