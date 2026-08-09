import type { DashboardTab } from "../components/DashboardTabs";
import { eventIdSchema } from "@/shared/contracts";
import { DEMO_EVENT_ID } from "@/shared/demo/seed";

export function resolveDashboardTab(requested: string | undefined, fallback: DashboardTab): DashboardTab {
  return requested === "today" || requested === "speakers" ? requested : fallback;
}

export function resolveLocalDashboardEventId(requested: string): string | null {
  if (requested === DEMO_EVENT_ID) return requested;
  return eventIdSchema.safeParse(requested).success ? requested : null;
}
