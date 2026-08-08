import type { Metadata } from "next";
import { CfpWizard } from "@/features/forms/cfp-wizard";

export const metadata: Metadata = { title: "Call for speakers" };
export default async function Page({ params }: { params: Promise<{ eventSlug: string; formId: string }> }) {
  const { eventSlug, formId } = await params;
  return <CfpWizard eventSlug={eventSlug} formId={formId} />;
}
