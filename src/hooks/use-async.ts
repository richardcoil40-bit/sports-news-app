import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  /** null until the first successful result lands. */
  data: T | null;
  loading: boolean;
  error: boolean;
  /**
   * Starts the load if it hasn't run yet. A no-op while a request is in
   * flight or after one has succeeded, so it's safe to call from an effect
   * that re-runs (e.g. on every tab change). A previous *failure* doesn't
   * count as having run — calling again retries.
   */
  load: () => void;
  /** Forces a fresh load even if data is already present. */
  reload: () => void;
}

/**
 * One data/loading/error triple with the cancellation guard built in.
 *
 * The loader is handed a `publish` callback for results that arrive in
 * stages — the team schedule renders as soon as the games are known and
 * fills in betting odds a moment later, rather than making the whole tab
 * wait on the slowest odds request. Loaders that resolve once can ignore it.
 */
export function useAsync<T>(load: (publish: (value: T) => void) => Promise<T>): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // A requestId rather than a `cancelled` flag: this hook's job is to stop a
  // slow earlier response from overwriting a newer one, not to stop responses
  // arriving at all. (An earlier version of this screen used a per-effect
  // `cancelled` flag that flipped on every tab switch, which meant switching
  // away mid-load left `loading` stuck true and that tab never recovered.)
  const requestId = useRef(0);

  // Mirrors of the two pieces of state that gate re-entry. Read through refs
  // so `load` can stay referentially stable and still see current values —
  // state captured in the callback's closure would be a render behind.
  const dataRef = useRef<T | null>(null);
  const inFlightRef = useRef(false);

  // The loader closes over screen params, so it's a new function every
  // render. Keep the latest one in a ref so `load` doesn't have to change
  // identity with it. Synced in an effect rather than assigned during
  // render (refs aren't safe to touch mid-render); the ref's initial value
  // covers the first pass, and this effect is registered before the
  // consuming screen's own effects, so it's always current by the time
  // anything calls load().
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const run = useCallback((force: boolean) => {
    if (!force && (dataRef.current !== null || inFlightRef.current)) return;

    const id = ++requestId.current;
    inFlightRef.current = true;
    setLoading(true);
    setError(false);

    const publish = (value: T) => {
      if (id !== requestId.current) return;
      dataRef.current = value;
      setData(value);
    };

    loadRef.current(publish).then(
      (value) => {
        if (id !== requestId.current) return;
        dataRef.current = value;
        inFlightRef.current = false;
        setData(value);
        setLoading(false);
      },
      () => {
        if (id !== requestId.current) return;
        inFlightRef.current = false;
        setError(true);
        setLoading(false);
      },
    );
  }, []);

  return {
    data,
    loading,
    error,
    load: useCallback(() => run(false), [run]),
    reload: useCallback(() => run(true), [run]),
  };
}
