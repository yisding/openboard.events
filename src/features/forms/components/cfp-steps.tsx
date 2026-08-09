"use client";

import { useEffect, useState } from "react";
import type { PublicForm } from "@/features/forms";
import { FormFieldRenderer } from "./form-field-renderer";
import type { AnswerValue, ContactId, FieldId, FormSnapshot } from "@/shared/contracts";
import { FormUploadProvider } from "@/shared/ui/app/form-upload-context";
import { Button } from "@/shared/ui/ui-kit";

/**
 * The public CFP wizard: account, submission, speaker, review.
 *
 * The account step comes first on purpose. Signing in before the questions is
 * what creates the server draft, so a speaker who closes the tab at the review
 * step has not lost their work — and it is what gives their submission its SESS
 * code before they ever press submit.
 */
type Step = "account" | "submission" | "speaker" | "review" | "done";

type Answers = Record<string, AnswerValue | undefined>;

async function request(path: string, body: unknown, method: "POST" | "PATCH" = "POST"): Promise<{ ok: boolean; data: Record<string, unknown>; message: string; fieldErrors?: Record<string, string> }> {
  const response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null) as {
    data?: Record<string, unknown>;
    error?: { message?: string; data?: { fieldErrors?: Record<string, string> }; fieldErrors?: Record<string, string> };
  } | null;
  if (!response.ok || !payload?.data) {
    return {
      ok: false,
      data: {},
      message: payload?.error?.message ?? "Something went wrong",
      ...(payload?.error?.data?.fieldErrors ? { fieldErrors: payload.error.data.fieldErrors } : {}),
      ...(payload?.error?.fieldErrors ? { fieldErrors: payload.error.fieldErrors } : {}),
    };
  }
  return { ok: true, data: payload.data, message: "" };
}

export function CfpSteps({ data }: { data: PublicForm }) {
  const { event, form, snapshot } = data;
  const [step, setStep] = useState<Step>("account");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeRequested, setCodeRequested] = useState(false);
  const [fallbackOtp, setFallbackOtp] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [contactId, setContactId] = useState<ContactId | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "retry">("idle");
  const [result, setResult] = useState<{ code: number } | null>(null);

  const onChange = (fieldId: FieldId, value: AnswerValue | undefined) => {
    setAnswers((current) => ({ ...current, [fieldId]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
  };

  useEffect(() => {
    if (!draftId) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      void request(`/api/internal/forms/${form.id}/draft`, {
        eventId: event.id,
        formId: form.id,
        formVersion: snapshot.version,
        answers,
      }, "PATCH").then((saved) => setSaveState(saved.ok ? "saved" : "retry"));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [answers, draftId, event.id, form.id, snapshot.version]);

  async function requestCode() {
    setBusy(true);
    setNotice("");
    const sent = await request("/api/internal/auth/portal/request", { eventSlug: event.slug, email: email.trim().toLowerCase() });
    setBusy(false);
    if (!sent.ok) { setNotice(sent.message); return; }
    // The preview surfaces the issued code inline; production never does, which
    // is why this is read from the response rather than assumed.
    const fallback = sent.data.fallback as { otp?: string } | undefined;
    setFallbackOtp(fallback?.otp ?? null);
    setCodeRequested(true);
    setNotice(String(sent.data.message ?? "We sent you a code"));
  }

  async function verifyAndStart() {
    setBusy(true);
    setNotice("");
    const verified = await request("/api/internal/auth/portal/verify", { eventSlug: event.slug, email: email.trim().toLowerCase(), code });
    if (!verified.ok) { setBusy(false); setNotice(verified.message); return; }
    const verifiedContactId = String(verified.data.contactId) as ContactId;

    // The draft exists from this moment, pinned to the version being rendered.
    const draft = await request(`/api/internal/forms/${form.id}/draft`, { eventId: event.id, formId: form.id, formVersion: snapshot.version });
    setBusy(false);
    if (!draft.ok) { setNotice(draft.message); return; }
    setDraftId(String(draft.data.submissionId));
    setContactId(verifiedContactId);
    const restored = (draft.data.answers ?? {}) as Answers;
    const emailField = snapshot.sections.flatMap((section) => section.fields).find((field) => field.key === "email");
    setAnswers((current) => ({
      ...restored,
      ...current,
      ...(emailField ? { [emailField.id]: { t: "s", v: email.trim().toLowerCase() } as const } : {}),
    }));
    setStep("submission");
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    setNotice("");
    const participantIds = new Set(snapshot.sections
      .filter((section) => section.key === "participant")
      .flatMap((section) => section.fields.map((field) => field.id)));
    const participantAnswers = Object.fromEntries(Object.entries(answers).filter(([fieldId]) => participantIds.has(fieldId as FieldId)));
    const sent = await request(`/api/internal/forms/${form.id}/submit`, {
      eventId: event.id,
      formId: form.id,
      formVersion: snapshot.version,
      draftSubmissionId: draftId,
      answers,
      ...(contactId ? {
        participants: [{ contactId, role: "speaker", isPrimary: true, sortOrder: 0, answers: participantAnswers }],
      } : {}),
    });
    setBusy(false);
    if (!sent.ok) {
      // Field errors belong next to their fields; anything else is a message.
      if (sent.fieldErrors) { setErrors(sent.fieldErrors); setStep(stepForErrors(snapshot, sent.fieldErrors)); }
      setNotice(sent.fieldErrors ? "Some answers need attention" : sent.message);
      return;
    }
    setResult({ code: Number(sent.data.code) });
    setDraftId(null);
    setStep("done");
  }

  if (step === "done" && result) {
    return (
      <section className="cfp-step">
        <h2>Thank you — your proposal is in</h2>
        <p>It is recorded as <b>SESS-{result.code}</b>. We have emailed a confirmation and a link to your speaker portal.</p>
        <a className="button button-primary" href={`/portal/${encodeURIComponent(event.slug)}`}>Open your speaker portal</a>
      </section>
    );
  }

  return (
    <FormUploadProvider eventId={event.id}>
    <section className="cfp-step">
      <ol className="cfp-progress">
        {(["account", "submission", "speaker", "review"] as const).map((name) => (
          <li key={name} className={step === name ? "active" : ""}>{name}</li>
        ))}
      </ol>

      {step === "account" && (
        <div className="form-grid">
          <label className="field">
            <span>Email address</span>
            <input type="email" value={email} onChange={(change) => setEmail(change.target.value)} autoComplete="email" />
          </label>
          {!codeRequested ? (
            <Button onClick={requestCode} disabled={busy || email.trim() === ""}>{busy ? "Sending…" : "Send me a code"}</Button>
          ) : (
            <>
              <label className="field">
                <span>Six-digit code</span>
                <input inputMode="numeric" value={code} onChange={(change) => setCode(change.target.value)} />
              </label>
              {/* Development diagnostics only — production does not return this. */}
              {fallbackOtp && <p className="demo-code">Development code: <code>{fallbackOtp}</code></p>}
              <Button onClick={verifyAndStart} disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Continue"}</Button>
            </>
          )}
        </div>
      )}

      {step === "submission" && (
        <>
          <FormFieldRenderer snapshot={snapshot} answers={answers} onChange={onChange} mode="edit" sectionKeys={["abstract"]} errors={errors} />
          <div className="cfp-actions">
            <Button onClick={() => setStep("speaker")}>Continue</Button>
          </div>
        </>
      )}

      {step === "speaker" && (
        <>
          <FormFieldRenderer snapshot={snapshot} answers={answers} onChange={onChange} mode="edit" sectionKeys={["participant"]} errors={errors} />
          <div className="cfp-actions">
            <Button variant="secondary" onClick={() => setStep("submission")}>Back</Button>
            <Button onClick={() => setStep("review")}>Review</Button>
          </div>
        </>
      )}

      {step === "review" && (
        <>
          {/* Read-back in review mode: the speaker checks what will be stored,
              which is also where a stale hidden answer would be conspicuous. */}
          <FormFieldRenderer snapshot={snapshot} answers={answers} onChange={onChange} mode="review" />
          <div className="cfp-actions">
            <Button variant="secondary" onClick={() => setStep("speaker")}>Back</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Submitting…" : "Submit proposal"}</Button>
          </div>
        </>
      )}

      {notice && <p className="cfp-notice" role="status">{notice}</p>}
      {draftId && <p className="autosave" aria-live="polite">{saveState === "saving" ? "Saving…" : saveState === "retry" ? "Changes will retry" : saveState === "saved" ? "Saved" : ""}</p>}
    </section>
    </FormUploadProvider>
  );
}

export function stepForErrors(snapshot: FormSnapshot, fieldErrors: Record<string, string>): "submission" | "speaker" {
  const participantFields = new Set(snapshot.sections
    .filter((section) => section.key === "participant")
    .flatMap((section) => section.fields.map((field) => field.id)));
  return Object.keys(fieldErrors).some((fieldId) => participantFields.has(fieldId as FieldId)) ? "speaker" : "submission";
}
