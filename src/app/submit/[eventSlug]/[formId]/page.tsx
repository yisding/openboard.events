import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePortal } from "@/features/auth";
import { getPublicForm } from "@/features/forms";
import { CfpSteps } from "@/features/forms/components/cfp-steps";
import { PublicFormGate } from "@/features/forms/components/public-form-gate";
import { formIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

export const metadata: Metadata = { title: "Call for speakers" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventSlug: string; formId: string }> }) {
  const { eventSlug, formId } = await params;
  const parsed = formIdSchema.safeParse(formId);
  if (!parsed.success) notFound();

  const data = await getPublicForm(eventSlug, parsed.data).catch((error: unknown) => {
    // A form that does not exist, belongs to another event, or is a portal form
    // are all the same 404 to somebody holding a link.
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  // The wizard's step lives in client state, so a reload lands back on "Verify
  // your email" unless the session that step already established is handed down.
  // A missing, expired or foreign cookie resolves to null and the speaker signs
  // in as before.
  const session = await requirePortal(eventSlug).catch(() => null);

  return (
    <main className="cfp-container">
      <PublicFormGate data={data}>
        <CfpSteps data={data} signedInEmail={session?.email ?? null} />
      </PublicFormGate>
    </main>
  );
}
