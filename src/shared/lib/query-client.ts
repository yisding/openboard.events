import {
  QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { QUERY_DEFAULTS } from "./query-keys";

export type QuerySeed = {
  queryKey: QueryKey;
  data: unknown;
  updatedAt?: number;
};

/** One cache policy for every route-scoped TanStack Query boundary. */
export function createQueryClient(seeds: readonly QuerySeed[] = []): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: QUERY_DEFAULTS,
      mutations: { retry: false },
    },
  });
  for (const seed of seeds) {
    queryClient.setQueryData(seed.queryKey, seed.data, {
      updatedAt: seed.updatedAt ?? Date.now(),
    });
  }
  return queryClient;
}
