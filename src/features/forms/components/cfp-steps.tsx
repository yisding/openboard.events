"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicForm } from "@/features/forms";
import { FormFieldRenderer } from "./form-field-renderer";
import type { AnswerValue, FieldId, FormSnapshot } from "@/shared/contracts";
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
export type ParticipantDraft = { clientId: string; answers: Answers };
type AutosaveSnapshot = { answers: Answers; participants: ParticipantDraft[] };

export type RequestResult = { ok: boolean; data: Record<string, unknown>; message: string; fieldErrors?: Record<string, string>; retryable?: boolean };
export type AutosaveState = "idle" | "saving" | "saved" | "retrying" | "failed";

export function cfpFlowSteps(collectParticipants: boolean): Array<Exclude<Step, "done">> {
  return collectParticipants
    ? ["account", "submission", "speaker", "review"]
    : ["account", "submission", "review"];
}

export function participantFieldIds(snapshot: FormSnapshot): Set<string> {
  return new Set(snapshot.sections
    .filter((section) => section.key === "participant")
    .flatMap((section) => section.fields.map((field) => field.id)));
}

export function participantEmail(snapshot: FormSnapshot, answers: Answers): string {
  const emailField = snapshot.sections
    .filter((section) => section.key === "participant")
    .flatMap((section) => section.fields)
    .find((field) => field.mapsTo === "contact.email" || field.key === "email");
  const value = emailField ? answers[emailField.id] : undefined;
  return value?.t === "s" ? value.v.trim().toLowerCase() : "";
}

export function hasIncompleteParticipantEmail(snapshot: FormSnapshot, participants: ReadonlyArray<ParticipantDraft>): boolean {
  return participants.some((participant) => participantEmail(snapshot, participant.answers) === "");
}

async function request(path: string, body: unknown, method: "POST" | "PATCH" = "POST"): Promise<RequestResult> {
  let response: Response;
  try {
    response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, data: {}, message: "Could not reach the server", retryable: true };
  }
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
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
    };
  }
  return { ok: true, data: payload.data, message: "" };
}

export async function saveWithRetry(
  save: () => Promise<RequestResult>,
  onState: (state: AutosaveState) => void,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    onState(attempt === 0 ? "saving" : "retrying");
    const result = await save();
    if (result.ok) {
      onState("saved");
      return true;
    }
    if (!result.retryable || attempt === 2) break;
    await wait(250 * (2 ** attempt));
  }
  onState("failed");
  return false;
}

/** Queue full-answer snapshots so a slow older PATCH cannot overwrite a newer one. */
export function serializeAutosaves<T>(save: (snapshot: T) => Promise<boolean>): (snapshot: T) => Promise<boolean> {
  let tail: Promise<unknown> = Promise.resolve();
  return (snapshot) => {
    const pending = tail.then(() => save(snapshot));
    tail = pending.catch(() => false);
    return pending;
  };
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
  const [draftRestored, setDraftRestored] = useState(false);
  const [coSpeakers, setCoSpeakers] = useState<ParticipantDraft[]>([]);
  const [saveState, setSaveState] = useState<AutosaveState>("idle");
  const [result, setResult] = useState<{ code: number } | null>(null);
  const flowSteps = cfpFlowSteps(form.collectParticipants);
  /**
   * Closed the moment submit is in flight. Submit promotes the draft row in
   * place, so a debounced PATCH that lands after it has no draft left to write
   * to and comes back 404 — a console error on an otherwise successful
   * submission. Reopened if the submit is rejected, because then the draft is
   * still a draft and the speaker is still editing.
   */
  const submitting = useRef(false);
  const nextCoSpeaker = useRef(1);
  const autosave = useRef<((snapshotState: AutosaveSnapshot) => Promise<boolean>) | null>(null);
  autosave.current ??= serializeAutosaves((snapshotState) => {
    if (submitting.current) { setSaveState("saved"); return Promise.resolve(true); }
    const participants = snapshotState.participants
      .map((participant, index) => ({
        clientId: participant.clientId,
        email: participantEmail(snapshot, participant.answers),
        answers: participant.answers,
        role: "co_speaker" as const,
        isPrimary: false as const,
        sortOrder: index + 1,
      }));
    if (hasIncompleteParticipantEmail(snapshot, snapshotState.participants)) {
      // Draft participant rows require a real contact email. Do not send a
      // partial snapshot that would silently discard the still-unidentified
      // co-speaker, and do not report the primary answers as saved either.
      setSaveState("failed");
      return Promise.resolve(false);
    }
    return saveWithRetry(
      () => request(`/api/internal/forms/${form.id}/draft`, {
        formVersion: snapshot.version,
        answers: snapshotState.answers,
        participants,
      }, "PATCH"),
      setSaveState,
    );
  });

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
      if (submitting.current) return;
      void autosave.current?.({ answers: { ...answers }, participants: [...coSpeakers] });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [answers, coSpeakers, draftId]);

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

    // The draft exists from this moment, pinned to the version being rendered.
    const draft = await request(`/api/internal/forms/${form.id}/draft`, { formVersion: snapshot.version });
    setBusy(false);
    if (!draft.ok) { setNotice(draft.message); return; }
    setDraftId(String(draft.data.submissionId));
    const restored = (draft.data.answers ?? {}) as Answers;
    const restoredParticipants = Array.isArray(draft.data.participants)
      ? draft.data.participants as Array<{ clientId?: unknown; answers?: unknown }>
      : [];
    setCoSpeakers(restoredParticipants
      .filter((participant) => typeof participant.clientId === "string" && participant.answers && typeof participant.answers === "object")
      .map((participant) => ({ clientId: participant.clientId as string, answers: participant.answers as Answers })));
    setDraftRestored(Object.keys(restored).length > 0 || restoredParticipants.length > 0);
    const emailField = snapshot.sections.flatMap((section) => section.fields).find((field) => field.key === "email");
    setAnswers((current) => ({
      ...restored,
      ...current,
      ...(emailField ? { [emailField.id]: { t: "s", v: email.trim().toLowerCase() } as const } : {}),
    }));
    setStep("submission");
  }

  function addCoSpeaker() {
    const number = nextCoSpeaker.current;
    nextCoSpeaker.current += 1;
    setCoSpeakers((current) => [...current, { clientId: `co-speaker-${number}`, answers: {} }]);
  }

  function updateCoSpeaker(clientId: string, fieldId: FieldId, value: AnswerValue | undefined) {
    setCoSpeakers((current) => current.map((participant) => (
      participant.clientId === clientId
        ? { ...participant, answers: { ...participant.answers, [fieldId]: value } }
        : participant
    )));
    setErrors((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
  }

  function removeCoSpeaker(clientId: string) {
    setCoSpeakers((current) => current.filter((participant) => participant.clientId !== clientId));
  }

  async function submit() {
    submitting.current = true;
    setBusy(true);
    setErrors({});
    setNotice("");
    const participantIds = participantFieldIds(snapshot);
    const participantAnswers = Object.fromEntries(Object.entries(answers).filter(([fieldId]) => participantIds.has(fieldId as FieldId)));
    const coSpeakerParticipants = coSpeakers.map((participant, index) => ({
      participant,
      email: participantEmail(snapshot, participant.answers),
      sortOrder: index + 1,
    }));
    const duplicateEmails = new Set<string>();
    const primaryEmail = email.trim().toLowerCase();
    if (coSpeakerParticipants.some(({ email: coSpeakerEmail }) => {
      if (!coSpeakerEmail || duplicateEmails.has(coSpeakerEmail) || coSpeakerEmail === primaryEmail) return true;
      duplicateEmails.add(coSpeakerEmail);
      return false;
    })) {
      submitting.current = false;
      setBusy(false);
      setNotice("Each co-speaker needs a unique email address");
      setStep("speaker");
      return;
    }
    const sent = await request(`/api/internal/forms/${form.id}/submit`, {
      formVersion: snapshot.version,
      draftSubmissionId: draftId,
      answers,
      participants: [{
        clientId: "primary",
        email: email.trim().toLowerCase(),
        role: "speaker",
        isPrimary: true,
        sortOrder: 0,
        answers: participantAnswers,
      }, ...coSpeakerParticipants.map(({ participant, email: participantEmailAddress, sortOrder }) => ({
        clientId: participant.clientId,
        email: participantEmailAddress,
        role: "co_speaker" as const,
        isPrimary: false,
        sortOrder,
        answers: Object.fromEntries(Object.entries(participant.answers).filter(([fieldId]) => participantIds.has(fieldId as FieldId))),
      }))],
    });
    setBusy(false);
    if (!sent.ok) {
      // The draft was not promoted, so autosave has somewhere to write again.
      submitting.current = false;
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
        {flowSteps.map((name) => (
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
          {draftRestored && (
            <div className="cfp-draft-resume" role="status">
              <b>Saved draft restored</b>
              <span>Your previous answers are back. Continue when ready.</span>
            </div>
          )}
          <FormFieldRenderer snapshot={snapshot} answers={answers} onChange={onChange} mode="edit" sectionKeys={["abstract"]} errors={errors} />
          <div className="cfp-actions">
            <Button onClick={() => setStep(form.collectParticipants ? "speaker" : "review")}>Continue</Button>
          </div>
        </>
      )}

      {form.collectParticipants && step === "speaker" && (
        <>
          <FormFieldRenderer snapshot={snapshot} answers={answers} onChange={onChange} mode="edit" sectionKeys={["participant"]} errors={errors} />
          {coSpeakers.map((participant, index) => (
            <div className="co-speaker-fields" key={participant.clientId}>
              <div className="review-block__header">
                <h3>Co-speaker {index + 1}</h3>
                <button type="button" className="button button-secondary" onClick={() => removeCoSpeaker(participant.clientId)}>Remove</button>
              </div>
              <FormFieldRenderer
                snapshot={snapshot}
                answers={participant.answers}
                onChange={(fieldId, value) => updateCoSpeaker(participant.clientId, fieldId, value)}
                mode="edit"
                sectionKeys={["participant"]}
                participantId={participant.clientId}
                visibilityAnswers={answers}
                errors={errors}
              />
            </div>
          ))}
          <button type="button" className="add-cospeaker" onClick={addCoSpeaker}>
            <b>Add a co-speaker</b>
            <span>Include another person on this proposal.</span>
          </button>
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
          {coSpeakers.length > 0 && (
            <div className="review-block">
              <div className="review-block__header"><h3>Co-speakers</h3></div>
              {coSpeakers.map((participant, index) => (
                <div className="review-block" key={participant.clientId}>
                  <h4>Co-speaker {index + 1}</h4>
                  <FormFieldRenderer
                    snapshot={snapshot}
                    answers={participant.answers}
                    onChange={() => undefined}
                    mode="review"
                    sectionKeys={["participant"]}
                    participantId={participant.clientId}
                    visibilityAnswers={answers}
                  />
                </div>
              ))}
            </div>
          )}
          <div className="cfp-actions">
            <Button variant="secondary" onClick={() => setStep(form.collectParticipants ? "speaker" : "submission")}>Back</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Submitting…" : "Submit proposal"}</Button>
          </div>
        </>
      )}

      {notice && <p className="cfp-notice" role="status">{notice}</p>}
      {draftId && (
        <div className="autosave" aria-live="polite">
          {saveState === "saving" && "Saving…"}
          {saveState === "retrying" && "Save interrupted — retrying…"}
          {saveState === "saved" && "Saved"}
          {saveState === "failed" && (
            <>
              <span>Changes are not saved.</span>{" "}
              <button type="button" onClick={() => void autosave.current?.({ answers: { ...answers }, participants: [...coSpeakers] })}>Retry now</button>
            </>
          )}
        </div>
      )}
    </section>
    </FormUploadProvider>
  );
}

export function stepForErrors(snapshot: FormSnapshot, fieldErrors: Record<string, string>): "submission" | "speaker" {
  const participantFields = participantFieldIds(snapshot);
  return Object.keys(fieldErrors).some((fieldId) => participantFields.has(fieldId as FieldId)) ? "speaker" : "submission";
}
