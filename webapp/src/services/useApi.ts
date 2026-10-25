import { useEffect, useState, type DependencyList } from 'react';
import { useSession } from '../state/SessionContext';

interface ApiState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
}

/** Calls a fetcher and re-runs it when deps or the active session change. */
export function useApi<T>(fetcher: () => Promise<T>, deps: DependencyList = []): ApiState<T> {
  const { session } = useSession();
  const [state, setState] = useState<ApiState<T>>({ data: undefined, error: undefined, loading: true });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    fetcher().then(
      (data) => !cancelled && setState({ data, error: undefined, loading: false }),
      (error: Error) => !cancelled && setState({ data: undefined, error, loading: false }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, ...deps]);

  return state;
}
