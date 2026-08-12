import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePortalContext } from "@/features/portal";
import { getResourcePage } from "@/features/portal/resources";
import { ResourcePageDetailView } from "@/features/portal/resources/components/portal-resource-detail";

export const metadata: Metadata = { title: "Resource" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventSlug: string; slug: string }> }) {
  const { eventSlug, slug } = await params;
  const { event } = await requirePortalContext(eventSlug);
  const page = await getResourcePage(event.id, slug, { publishedOnly: true });
  // A draft and a slug that never existed produce the identical 404 — never a
  // 403 that would confirm to a speaker that an unpublished page exists.
  if (!page) notFound();

  return <ResourcePageDetailView eventSlug={event.slug} page={page} />;
}
