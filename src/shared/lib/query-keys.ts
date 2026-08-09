import type { EventId } from "@/shared/contracts";

export const QUERY_DEFAULTS = { staleTime: 15_000, refetchOnWindowFocus: true } as const;

export function qk(feature: string, eventId: EventId, ...parts: readonly unknown[]) {
  return [feature, eventId, ...parts] as const;
}
