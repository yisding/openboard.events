import { AdminShell } from "@/features/shell/admin-shell";
import { requireAdmin } from "@/features/auth";
import type { EventId } from "@/shared/contracts";

export default async function EventLayout({ children, params }: { children: React.ReactNode; params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  await requireAdmin(eventId as EventId);
  return <AdminShell eventId={eventId}>{children}</AdminShell>;
}
