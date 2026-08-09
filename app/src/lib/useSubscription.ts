"use client";

import { useEffect, useRef, useState } from "react";
import { getWsClient } from "./graphql-client";

interface State<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
}

/**
 * Minimal graphql-ws subscription hook. Re-subscribes whenever `query` or
 * `variables` (compared by JSON) change. No polling anywhere - this opens a
 * single websocket subscription against the Hasura GraphQL WS endpoint.
 */
export function useSubscription<T>(
  query: string,
  variables: Record<string, unknown>,
  enabled = true
): State<T> {
  const [state, setState] = useState<State<T>>({
    data: null,
    error: null,
    isLoading: true,
  });
  const varsKey = JSON.stringify(variables);

  const unsubRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) return;
    setState((s) => ({ ...s, isLoading: true }));
    const client = getWsClient();
    const unsubscribe = client.subscribe<T>(
      { query, variables: JSON.parse(varsKey) },
      {
        next: (result) => {
          setState({
            data: (result.data ?? null) as T | null,
            error: result.errors?.length ? new Error(result.errors[0].message) : null,
            isLoading: false,
          });
        },
        error: (err) => {
          setState({
            data: null,
            error: err instanceof Error ? err : new Error(String(err)),
            isLoading: false,
          });
        },
        complete: () => {
          setState((s) => ({ ...s, isLoading: false }));
        },
      }
    );
    unsubRef.current = unsubscribe;
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, varsKey, enabled]);

  return state;
}
