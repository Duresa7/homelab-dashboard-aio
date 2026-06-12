import { useCallback, useEffect, useRef, useState } from 'react';

import { apiJson, isAbortError } from './http';
import { effectiveIntervalMs } from './refresh-rate';

interface UseApiResourceOptions<T> {
  enabled?: boolean;
  initialData?: T | null;
  keepPreviousData?: boolean;
  pollMs?: number;
}

export interface ApiResource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: (urlOverride?: string | null) => Promise<void>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useApiResource<T>(
  url: string | null | undefined,
  options: UseApiResourceOptions<T> = {},
): ApiResource<T> {
  const { enabled = true, initialData = null, keepPreviousData = true, pollMs } = options;
  const [data, setData] = useState<T | null>(initialData);
  const [loading, setLoading] = useState<boolean>(Boolean(enabled && url));
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(
    async (urlOverride?: string | null) => {
      const target = urlOverride === undefined ? url : urlOverride;
      if (!enabled || !target) {
        controllerRef.current?.abort();
        controllerRef.current = null;
        setData(initialData);
        setError(null);
        setLoading(false);
        return;
      }

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setLoading(true);
      setError(null);

      try {
        const next = await apiJson<T>(target, { signal: controller.signal });
        if (!controller.signal.aborted) setData(next);
      } catch (err) {
        if (isAbortError(err)) return;
        setError(errorMessage(err));
        if (!keepPreviousData) setData(initialData);
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setLoading(false);
        }
      }
    },
    [enabled, initialData, keepPreviousData, url],
  );

  useEffect(() => {
    void refresh();
    if (!enabled || !url || !pollMs) {
      return () => {
        controllerRef.current?.abort();
      };
    }

    const timer = setInterval(() => {
      void refresh();
    }, effectiveIntervalMs(pollMs));

    return () => {
      clearInterval(timer);
      controllerRef.current?.abort();
    };
  }, [enabled, pollMs, refresh, url]);

  return { data, loading, error, refresh };
}
