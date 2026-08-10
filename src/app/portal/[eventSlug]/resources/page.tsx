import type { Metadata } from "next";
import { requirePortalContext } from "@/features/portal";
import { listResourcePages } from "@/features/portal/resources";
import { PortalResourceList } from "@/features/portal/resources/components/portal-resource-list";
import { PortalResources } from "@/features/portal/portal-resources";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";

export const metadata: Metadata = { title: "Resources" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  // The credential-free demo has no database to read; everywhere else these
  // are the event's real, published resource pages.
  if (isCredentialFreeLocalDemo()) return <PortalResources />;

  const { event } = await requirePortalContext(eventSlug);
  // Enforced server-side, never by a client filter (R4): an unpublished page
  // never leaves this query.
  const pages = await listResourcePages(event.id, { publishedOnly: true });

  return <PortalResourceList eventSlug={event.slug} pages={pages} />;
}
