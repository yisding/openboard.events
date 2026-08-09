import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicForm } from "@/features/forms";
import { CfpSteps } from "@/features/forms/components/cfp-steps";
import { PublicFormGate } from "@/features/forms/components/public-form-gate";
import { CfpWizard } from "@/features/forms/cfp-wizard";
import { formIdSchema } from "@/shared/contracts";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";
import { isAppError } from "@/shared/lib/errors";

export const metadata: Metadata = { title: "Call for speakers" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventSlug: string; formId: string }> }) {
  const { eventSlug, formId } = await params;
  // The credential-free demo has no database; everywhere else this is the real
  // form, with its real branding and its real deadline.
  if (isCredentialFreeLocalDemo()) return <CfpWizard eventSlug={eventSlug} formId={formId} />;

  const parsed = formIdSchema.safeParse(formId);
  if (!parsed.success) notFound();

  const data = await getPublicForm(eventSlug, parsed.data).catch((error: unknown) => {
    // A form that does not exist, belongs to another event, or is a portal form
    // are all the same 404 to somebody holding a link.
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  return (
    <main className="cfp-container">
      <PublicFormGate data={data}>
        <CfpSteps data={data} />
      </PublicFormGate>
    </main>
  );
}
