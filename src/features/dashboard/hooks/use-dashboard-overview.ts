"use client";

import { useQuery } from "@tanstack/react-query";
import type { EventId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { qk } from "@/shared/lib/query-keys";
import { dashboardOverviewSchema, type DashboardOverview } from "../index";

export function useDashboardOverview(eventId: EventId, initialData: DashboardOverview, live = true) {
  return useQuery({
    queryKey: qk("dashboard", eventId, "overview"),
    queryFn: () => api(`dashboard/${eventId}/overview`, dashboardOverviewSchema),
    initialData,
    enabled: live,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}
