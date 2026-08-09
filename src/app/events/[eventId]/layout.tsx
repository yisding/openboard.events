import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AdminShell } from "@/features/shell/admin-shell";
import { requireAdmin } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { eventIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

export default async function EventLayout({ children, params }: { children: React.ReactNode; params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const parsedEventId = eventIdSchema.safeParse(eventId);
  if (!parsedEventId.success) notFound();
  try {
    await requireAdmin(parsedEventId.data);
  } catch (error) {
    if (!isAppError(error)) throw error;
    if (error.code === "UNAUTHORIZED") {
      const requestPath = safeInternalPath((await headers()).get("x-openboard-request-path"));
      redirect(`/login?next=${encodeURIComponent(requestPath)}`);
    }
    if (error.code === "FORBIDDEN") {
      return <main className="empty-state"><h1>Access denied</h1><p>You do not have access to this event.</p><Link className="button button-primary" href="/events">Choose another event</Link></main>;
    }
    throw error;
  }
  return <AdminShell eventId={parsedEventId.data}>{children}</AdminShell>;
}
