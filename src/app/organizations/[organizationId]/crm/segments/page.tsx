import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireOrganizationAdmin } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { listOrganizationEvents } from "@/features/organizations";
import { listCrmSegments, listCrmTags } from "@/features/crm";
import { SegmentsView } from "@/features/crm/components/segments-view";
import { organizationIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

export const metadata: Metadata = { title: "Segments" };
export const dynamic = "force-dynamic";

/** M55 — saved dynamic segments (work order: "segment builder"). */
export default async function Page({ params }: { params: Promise<{ organizationId: string }> }) {
  const parsed = organizationIdSchema.safeParse((await params).organizationId);
  if (!parsed.success) notFound();
  const organizationId = parsed.data;

  try {
    await requireOrganizationAdmin(organizationId, "organizer");
  } catch (error) {
    if (!isAppError(error)) throw error;
    if (error.code === "UNAUTHORIZED") {
      const requestPath = safeInternalPath((await headers()).get("x-openboard-request-path"), "/organizations");
      redirect(`/login?next=${encodeURIComponent(requestPath)}`);
    }
    notFound();
  }

  const [segments, tags, events] = await Promise.all([
    listCrmSegments(organizationId),
    listCrmTags(organizationId),
    listOrganizationEvents(organizationId),
  ]);

  return <SegmentsView organizationId={organizationId} initialSegments={segments} tags={tags} events={events} />;
}
