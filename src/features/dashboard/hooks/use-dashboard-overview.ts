"use client";

import { useQuery } from "@tanstack/react-query";
import type { EventId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { qk, QUERY_DEFAULTS } from "@/shared/lib/query-keys";
import { dashboardOverviewSchema } from "../index";

export const dashboardKeys = {
  all: (eventId: EventId) => qk("dashboard", eventId),
  overview: (eventId: EventId) => qk("dashboard", eventId, "overview"),
} as const;

export function useDashboardOverview(eventId: EventId, live = true) {
  return useQuery({
    queryKey: dashboardKeys.overview(eventId),
    queryFn: () => api(`dashboard/${eventId}/overview`, dashboardOverviewSchema),
    ...QUERY_DEFAULTS,
    enabled: live,
    refetchInterval: 30_000,
  });
}
