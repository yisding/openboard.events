import { AdminShell } from "@/features/shell/admin-shell";

export default async function EventLayout({ children, params }: { children: React.ReactNode; params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <AdminShell eventId={eventId}>{children}</AdminShell>;
}
