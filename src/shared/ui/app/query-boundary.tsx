"use client";

import {
  dehydrate,
  HydrationBoundary,
  QueryClientContext,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useContext, useState, type ReactNode } from "react";
import { createQueryClient, type QuerySeed } from "@/shared/lib/query-client";

/**
 * Creates a route-local cache when needed and reuses the nearest cache when
 * embedded. This prevents reusable panels from silently splitting mutations
 * and reads across nested QueryClient instances.
 */
export function QueryBoundary({
  children,
  seeds = [],
}: {
  children: ReactNode;
  seeds?: readonly QuerySeed[];
}) {
  const inheritedClient = useContext(QueryClientContext);
  const [localClient] = useState(() => createQueryClient(seeds));
  const [seededState] = useState(() => dehydrate(localClient));
  const content = <HydrationBoundary state={seededState}>{children}</HydrationBoundary>;

  if (inheritedClient) return content;
  return <QueryClientProvider client={localClient}>{content}</QueryClientProvider>;
}
