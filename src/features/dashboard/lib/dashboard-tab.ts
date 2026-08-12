import type { DashboardTab } from "../components/DashboardTabs";

export function resolveDashboardTab(requested: string | undefined, fallback: DashboardTab): DashboardTab {
  return requested === "today" || requested === "speakers" ? requested : fallback;
}
