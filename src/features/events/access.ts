import type { EventId, MemberRole } from "@/shared/contracts";

/** Reviewers land on their only event surface; unassigned directory rows stay inert. */
export function eventManagementHref(eventId: EventId, role: MemberRole | null): string | null {
  if (!role) return null;
  return `/events/${eventId}/${role === "reviewer" ? "review" : "dashboard"}`;
}
