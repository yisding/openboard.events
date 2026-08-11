import type { EventId } from "@/shared/contracts";

/** Keep dnd-kit's described-by/live-region ids identical across SSR and hydration. */
export function agendaDayDndContextId(eventId: EventId, day: string): string {
  return `agenda-day-${eventId}-${day}`;
}
