import type { Metadata } from "next";
import { FormBuilder } from "@/features/forms/form-builder";

export const metadata: Metadata = { title: "Form builder" };
export default async function Page({ params }: { params: Promise<{ eventId: string; formId: string }> }) {
  const { eventId, formId } = await params;
  return <FormBuilder eventId={eventId} formId={formId} />;
}
