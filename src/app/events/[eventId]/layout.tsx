import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AdminShell, type AdminShellCounts, type AdminShellEvent } from "@/features/shell/admin-shell";
import { getNavCounts, getReviewerQueueCount } from "@/features/shell/server/nav-counts";
import { shortEventName } from "@/shared/lib/event-label";
import { requireAdmin, requiredRoleForEventPath, type AdminSession } from "@/features/auth";
import { getEvent } from "@/features/events";
import { resolveLocalDashboardEventId } from "@/features/dashboard/lib/dashboard-tab";
import { safeInternalPath } from "@/features/auth/safe-next";
import { eventIdSchema, type EventId } from "@/shared/contracts";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";
import { isAppError } from "@/shared/lib/errors";

export default async function EventLayout({ children, params }: { children: React.ReactNode; params: Promise<{ eventId: string }> }) {
  const requestedEventId = (await params).eventId;
  const localDemo = isCredentialFreeLocalDemo();
  const parsedEventId = eventIdSchema.safeParse(requestedEventId);
  const resolvedEventId = localDemo
    ? resolveLocalDashboardEventId(requestedEventId)
    : parsedEventId.success ? parsedEventId.data : null;
  if (!resolvedEventId) notFound();
  // The only non-UUID value accepted here is the credential-free local demo.
  // It never reaches an authenticated database boundary below.
  const eventId = resolvedEventId as EventId;
  const requestPath = safeInternalPath((await headers()).get("x-openboard-request-path"));
  let session: AdminSession | null = null;
  // The shell's own event data comes from this server read, never from the
  // browser demo fixture: a real event id is never in that fixture, so a
  // client-side lookup 404s every authenticated admin surface (and renders an
  // empty SSR body on the way there).
  let shellEvent: AdminShellEvent | undefined;
  if (!localDemo) {
    try {
      session = await requireAdmin(eventId, requiredRoleForEventPath(eventId, requestPath));
    } catch (error) {
      if (!isAppError(error)) throw error;
      if (error.code === "UNAUTHORIZED") {
        redirect(`/login?next=${encodeURIComponent(requestPath)}`);
      }
      if (error.code === "FORBIDDEN") {
        return <main className="empty-state"><h1>Access denied</h1><p>You do not have access to this event surface.</p><Link className="button button-primary" href="/events">Choose another event</Link></main>;
      }
      throw error;
    }
    // Read after the guard, so an unauthorized caller never learns whether the
    // event exists.
    const record = await getEvent(eventId);
    if (!record) notFound();
    shellEvent = { id: record.id, slug: record.slug, name: record.name, shortName: shortEventName(record.name) };
  }
  // M56 — real, actionable sidebar counts. Reviewers only ever see the review
  // nav item, so they get their own outstanding-work count instead of the
  // organizer figures they are not allowed to read (M50's closed reviewer
  // surface list).
  let counts: AdminShellCounts | undefined;
  if (session) {
    if (session.role === "reviewer") {
      counts = { review: await getReviewerQueueCount(eventId, session.userId) };
    } else {
      const nav = await getNavCounts(eventId);
      counts = { abstracts: nav.abstractsPending, speakers: nav.speakersMissing, tasks: nav.tasksOverdue };
    }
  }
  return <AdminShell eventId={eventId} role={session?.role ?? "owner"} {...(shellEvent ? { event: shellEvent } : {})} {...(counts ? { counts } : {})}>{children}</AdminShell>;
}
