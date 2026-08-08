import type { Metadata } from "next";
import { FormBuilder } from "@/features/forms/form-builder";

export const metadata: Metadata = { title: "Form builder" };
export default async function Page({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params;
  return <FormBuilder formId={formId} />;
}
