"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormFieldRenderer } from "@/features/forms/components/form-field-renderer";
import { formatCode } from "@/features/submissions/index.client";
import type { AnswerValue, FormSnapshot } from "@/shared/contracts";
import { FormUploadProvider } from "@/shared/ui/app/form-upload-context";
import { useToast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/ui-kit";
import type { EditableSubmissionSummary } from "../server/queries";

/**
 * The speaker's single-page edit of one submission's abstract answers — no
 * step-wizard chrome, since this is a re-answer of one form, not the 5-step CFP
 * flow. Every save re-authorizes server-side: the gate re-runs, the DB clock
 * decides whether the form is still open, and the write goes through the same
 * pipeline + `updateSubmissionFromCfp` the route always uses (never a second
 * copy of that logic here).
 */
export function EditSubmissionForm({
  eventId,
  eventSlug,
  submissionId,
  submission,
  snapshot,
  answers: initialAnswers,
}: {
  eventId: string;
  eventSlug: string;
  submissionId: string;
  submission: EditableSubmissionSummary;
  snapshot: FormSnapshot;
  answers: Record<string, AnswerValue>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [answers, setAnswers] = useState<Record<string, AnswerValue | undefined>>(initialAnswers);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const detailHref = `/portal/${encodeURIComponent(eventSlug)}/submissions/${encodeURIComponent(submissionId)}`;
  // Only the abstract questions render here — the speaker roster is managed
  // through Profile, not resubmission (M18's mutation is answers-only).
  const sectionKeys = snapshot.sections.filter((section) => section.key !== "participant").map((section) => section.key);

  async function save() {
    setBusy(true);
    setFieldErrors({});
    try {
      // A dropped connection is the normal case on a phone in a conference hall,
      // so it has to read as "try again", not as a blank screen.
      const response = await fetch(`/api/internal/portal/submissions/${encodeURIComponent(submissionId)}/edit?eventId=${encodeURIComponent(eventId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ formVersion: snapshot.version, answers }),
      }).catch(() => null);
      if (!response) {
        toast("That did not reach us — check your connection and try again");
        return;
      }
      const payload = await response.json().catch(() => null) as {
        error?: { code?: string; message?: string; data?: { fieldErrors?: Record<string, string> } };
      } | null;
      if (!response.ok) {
        const errors = payload?.error?.data?.fieldErrors;
        if (errors) {
          setFieldErrors(errors);
          toast("Some answers need fixing");
          return;
        }
        // The deadline race M14's guard exists for: open at page load, closed by
        // the time Save is pressed. The read-only page already knows how to say
        // this, so send the speaker back to it rather than duplicate the copy.
        if (payload?.error?.code === "FORM_CLOSED") {
          toast("This call closed while you were editing");
          router.push(detailHref);
          router.refresh();
          return;
        }
        toast(payload?.error?.message ?? "That did not go through");
        return;
      }
      toast("Changes saved");
      router.push(detailHref);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="portal-submission-edit">
      <Link className="portal-back" href={detailHref}><ArrowLeft size={14} /> {formatCode(submission.code)}</Link>
      <header className="portal-page-header">
        <h1>Edit your proposal</h1>
        <p>{submission.title}</p>
      </header>
      <div className="portal-panel">
        <FormUploadProvider eventId={eventId}>
          <FormFieldRenderer
            snapshot={snapshot}
            answers={answers}
            onChange={(fieldId, value) => setAnswers((current) => ({ ...current, [fieldId]: value }))}
            mode="edit"
            sectionKeys={sectionKeys}
            errors={fieldErrors}
          />
        </FormUploadProvider>
        <Button disabled={busy} onClick={() => { void save(); }}>{busy ? "Saving…" : "Save changes"}</Button>
      </div>
    </article>
  );
}
