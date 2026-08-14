"use client";

import {
  dehydrate,
  HydrationBoundary,
  QueryClientContext,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useContext, useMemo, useState, type ReactNode } from "react";
import { createQueryClient, type QuerySeed } from "@/shared/lib/query-client";

const EMPTY_SEEDS: readonly QuerySeed[] = [];

/**
 * Creates a route-local cache when needed and reuses the nearest cache when
 * embedded. This prevents reusable panels from silently splitting mutations
 * and reads across nested QueryClient instances.
 */
export function QueryBoundary({
  children,
  seeds = EMPTY_SEEDS,
}: {
  children: ReactNode;
  seeds?: readonly QuerySeed[];
}) {
  const inheritedClient = useContext(QueryClientContext);
  const [localClient] = useState(() => createQueryClient(seeds));
  // A soft RSC navigation can return newer server seeds without remounting the
  // route shell. Rebuild only the lightweight dehydrated state so
  // HydrationBoundary can reconcile those reads into the existing cache.
  const seededState = useMemo(
    () => dehydrate(createQueryClient(seeds)),
    [seeds],
  );
  const content = <HydrationBoundary state={seededState}>{children}</HydrationBoundary>;

  if (inheritedClient) return content;
  return <QueryClientProvider client={localClient}>{content}</QueryClientProvider>;
}
