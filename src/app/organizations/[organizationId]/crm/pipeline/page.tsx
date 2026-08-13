import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireOrganizationAdmin } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { listOrganizationEvents } from "@/features/organizations";
import { getOrganizationContact, listCrmPipeline } from "@/features/crm";
import { PipelineBoard } from "@/features/crm/components/pipeline-board";
import { organizationIdSchema, type OrganizationContactId } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

export const metadata: Metadata = { title: "Sourcing pipeline" };
export const dynamic = "force-dynamic";

/** M55 — the sourcing-pipeline kanban. `listCrmPipeline` returns bare
 * `organizationContactId`s (no join — the read layer keeps that query
 * single-table); this page resolves each referenced contact once via
 * `getOrganizationContact` rather than adding a new joined query, since a
 * sourcing pipeline is small by nature (a handful to a few dozen open
 * prospects, not a directory-sized list). */
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

  const [entries, events] = await Promise.all([listCrmPipeline(organizationId), listOrganizationEvents(organizationId)]);

  const uniqueContactIds = [...new Set(entries.map((entry) => entry.organizationContactId))];
  const contactRows = await Promise.all(uniqueContactIds.map((id) => getOrganizationContact(organizationId, id)));
  const contactsById: Record<string, { id: OrganizationContactId; name: string; email: string; company: string | null }> = {};
  contactRows.forEach((contact, index) => {
    const id = uniqueContactIds[index];
    if (contact && id) contactsById[id] = { id: contact.id, name: `${contact.firstName} ${contact.lastName}`.trim() || contact.email, email: contact.email, company: contact.company };
  });

  return (
    <PipelineBoard
      organizationId={organizationId}
      initialEntries={entries}
      contactsById={contactsById}
      events={events}
    />
  );
}
