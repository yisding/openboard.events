import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireOrganizationAdmin } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { listOrganizationEvents } from "@/features/organizations";
import { getOrganizationContactHistory, listCrmCustomFields, listCrmTags } from "@/features/crm";
import { ContactDetailView } from "@/features/crm/components/contact-detail-view";
import { organizationContactIdSchema, organizationIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

export const metadata: Metadata = { title: "Contact" };
export const dynamic = "force-dynamic";

/** M55 — one organization contact's complete cross-event history (AC:
 * "inspect a contact's complete event/session/activity history without
 * leaking another organization" — the `organizationId` scope on
 * `getOrganizationContactHistory` is what enforces that; a malformed or
 * cross-organization id both 404, same discipline as the per-event speaker
 * detail page this mirrors). */
export default async function Page({ params }: { params: Promise<{ organizationId: string; organizationContactId: string }> }) {
  const raw = await params;
  const parsedOrg = organizationIdSchema.safeParse(raw.organizationId);
  const parsedContact = organizationContactIdSchema.safeParse(raw.organizationContactId);
  if (!parsedOrg.success || !parsedContact.success) notFound();
  const organizationId = parsedOrg.data;
  const organizationContactId = parsedContact.data;

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

  const [history, tags, customFields, events] = await Promise.all([
    getOrganizationContactHistory(organizationId, organizationContactId),
    listCrmTags(organizationId),
    listCrmCustomFields(organizationId),
    listOrganizationEvents(organizationId),
  ]);
  if (!history) notFound();

  return (
    <ContactDetailView
      organizationId={organizationId}
      initialHistory={history}
      allTags={tags}
      customFields={customFields}
      events={events}
    />
  );
}
