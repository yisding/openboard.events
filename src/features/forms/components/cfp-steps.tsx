"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicForm } from "@/features/forms";
import { splitParticipantFieldErrors } from "../participant-errors";
import { enabledSecondaryParticipantRoles, secondaryParticipantRoleSchema, type SecondaryParticipantRole } from "../participant-roles";
import { FormFieldRenderer } from "./form-field-renderer";
import { LIMITS, plainTextLength, type AnswerValue, type FieldId, type FormField, type FormSnapshot } from "@/shared/contracts";
import { evaluateVisibility } from "@/shared/lib/conditions";
import { FormUploadProvider } from "@/shared/ui/app/form-upload-context";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
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
export type ParticipantDraft = { clientId: string; role: SecondaryParticipantRole; answers: Answers };
type AutosaveSnapshot = { answers: Answers; participants: ParticipantDraft[] };

export type RequestResult = {
  ok: boolean;
  data: Record<string, unknown>;
  message: string;
  code?: string;
  errorData?: Record<string, unknown>;
  fieldErrors?: Record<string, string>;
  retryable?: boolean;
};
export type AutosaveState = "idle" | "saving" | "saved" | "retrying" | "failed";
export type CfpSubmitFailure = { kind: "stale"; message: string } | { kind: "ordinary"; message: string };
export type CfpSnapshotLock = { submitting: boolean; versionStale: boolean; submitted: boolean };
export type CfpSubmitSettlement = "ordinary-failure" | "stale-failure" | "success";

const STALE_FORM_MESSAGE = "The organizer updated this form while you were working. Reload the updated form to continue with the latest questions; your saved draft will be restored.";

export function cfpFlowSteps(collectParticipants: boolean): Array<Exclude<Step, "done">> {
  return collectParticipants
    ? ["account", "submission", "speaker", "review"]
    : ["account", "submission", "review"];
}

export function focusCfpAccountControl(
  codeRequested: boolean,
  emailControl: { focus: () => void } | null,
  codeControl: { focus: () => void } | null,
) {
  (codeRequested ? codeControl : emailControl)?.focus();
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

function answerIsEmpty(field: FormField, value: AnswerValue | undefined): boolean {
  if (value === undefined) return true;
  if (value.t === "s") return field.type === "richtext" ? plainTextLength(value.v) === 0 : value.v.trim() === "";
  if (value.t === "opt") return value.v === "";
  if (value.t === "opts") return value.v.length === 0;
  return false;
}

export function stepFieldErrors(
  snapshot: FormSnapshot,
  sectionKeys: string[],
  answers: Answers,
  visibilityAnswers: Answers = answers,
): Record<string, string> {
  const visible = evaluateVisibility(snapshot, { ...visibilityAnswers, ...answers });
  const keys = new Set(sectionKeys);
  const errors: Record<string, string> = {};
  for (const section of snapshot.sections) {
    if (!keys.has(section.key)) continue;
    for (const field of section.fields) {
      if (!visible.has(field.id)) continue;
      const value = answers[field.id];
      if (field.required && answerIsEmpty(field, value)) {
        errors[field.id] = `${field.label} is required`;
        continue;
      }
      if (value?.t === "s") {
        const max = field.maxChars ?? (field.type === "richtext" ? LIMITS.RICHTEXT : LIMITS.SHORT_TEXT);
        const used = field.type === "richtext" ? plainTextLength(value.v) : value.v.length;
        if (used > max) errors[field.id] = `Keep this under ${max} characters`;
      }
    }
  }
  return errors;
}

export function cfpStepHeading(snapshot: FormSnapshot, step: Exclude<Step, "done">): string {
  if (step === "account") return "Verify your email";
  if (step === "review") return "Review your proposal";
  const key = step === "submission" ? "abstract" : "participant";
  const section = snapshot.sections.find((candidate) => candidate.key === key);
  return section?.pageHeading || section?.title || (step === "submission" ? "Submission" : "Participant");
}

const PARTICIPANT_ROLE_LABELS: Record<SecondaryParticipantRole, string> = {
  co_speaker: "co-speaker",
  moderator: "moderator",
  panelist: "panelist",
};

export const CFP_PORTAL_REDIRECT_MS = 10_000;

export function schedulePortalRedirect(
  enabled: boolean,
  navigate: () => void,
  schedule?: (callback: () => void, milliseconds: number) => number,
  cancel?: (timer: number) => void,
): () => void {
  if (!enabled) return () => undefined;
  const timer = (schedule ?? ((callback, milliseconds) => window.setTimeout(callback, milliseconds)))(navigate, CFP_PORTAL_REDIRECT_MS);
  return () => (cancel ?? ((timerId) => window.clearTimeout(timerId)))(timer);
}

export async function cfpRequest(path: string, body: unknown, method: "POST" | "PATCH" = "POST"): Promise<RequestResult> {
  let response: Response;
  try {
    response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, data: {}, message: "Could not reach the server", retryable: true };
  }
  const payload = await response.json().catch(() => null) as {
    data?: Record<string, unknown>;
    error?: {
      code?: string;
      message?: string;
      data?: Record<string, unknown> & { fieldErrors?: Record<string, string> };
      fieldErrors?: Record<string, string>;
    };
  } | null;
  if (!response.ok || !payload?.data) {
    return {
      ok: false,
      data: {},
      message: payload?.error?.message ?? "Something went wrong",
      ...(payload?.error?.code ? { code: payload.error.code } : {}),
      ...(payload?.error?.data ? { errorData: payload.error.data } : {}),
      ...(payload?.error?.data?.fieldErrors ? { fieldErrors: payload.error.data.fieldErrors } : {}),
      ...(payload?.error?.fieldErrors ? { fieldErrors: payload.error.fieldErrors } : {}),
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
    };
  }
  return { ok: true, data: payload.data, message: "" };
}

export function cfpSubmitFailure(result: RequestResult): CfpSubmitFailure {
  return result.code === "FORM_VERSION_STALE"
    ? { kind: "stale", message: STALE_FORM_MESSAGE }
    : { kind: "ordinary", message: result.fieldErrors ? "Some answers need attention" : result.message };
}

export function requiresCfpFormReload(
  failure: CfpSubmitFailure | null,
): failure is Extract<CfpSubmitFailure, { kind: "stale" }> {
  return failure?.kind === "stale";
}

export function preserveStaleCfpFailure(failure: CfpSubmitFailure | null): CfpSubmitFailure | null {
  return requiresCfpFormReload(failure) ? failure : null;
}

export function beginCfpSubmit(lock: CfpSnapshotLock): boolean {
  if (lock.submitting || lock.versionStale || lock.submitted) return false;
  lock.submitting = true;
  return true;
}

export function abortCfpSubmit(lock: CfpSnapshotLock): void {
  lock.submitting = false;
}

export function lockStaleCfpSnapshot(lock: CfpSnapshotLock): boolean {
  if (lock.submitted) return false;
  lock.versionStale = true;
  return true;
}

export function settleCfpSubmitFailure(lock: CfpSnapshotLock, failure: CfpSubmitFailure): void {
  abortCfpSubmit(lock);
  if (requiresCfpFormReload(failure)) lockStaleCfpSnapshot(lock);
}

export function settleCfpSubmitSuccess(lock: CfpSnapshotLock): void {
  lock.submitting = false;
  lock.versionStale = false;
  lock.submitted = true;
}

export function cfpAutosaveDisposition(lock: CfpSnapshotLock): "save" | "defer" | "fail" | "discard" {
  if (lock.submitted) return "discard";
  if (lock.versionStale) return "fail";
  if (lock.submitting) return "defer";
  return "save";
}

/** Retain the newest full snapshot while submit owns the draft write lock. */
export function createDeferredCfpAutosave<T>() {
  let pending: T | null = null;
  return {
    defer(snapshotState: T, onState: (state: AutosaveState) => void): false {
      pending = snapshotState;
      onState("failed");
      return false;
    },
    hasPending(): boolean {
      return pending !== null;
    },
    async settle(
      settlement: CfpSubmitSettlement,
      persist: (snapshotState: T) => Promise<boolean>,
    ): Promise<boolean | null> {
      const snapshotState = pending;
      pending = null;
      if (settlement !== "ordinary-failure" || snapshotState === null) return null;
      return persist(snapshotState);
    },
  };
}

export function reloadUpdatedCfpForm(reload: () => void = () => window.location.reload()): void {
  reload();
}

export function CfpSubmitFailureNotice({ failure }: { failure: CfpSubmitFailure }) {
  return <p className="cfp-notice" role="alert">{failure.message}</p>;
}

export function scheduleCfpRecoveryFocus(
  heading: { focus: () => void } | null,
  schedule: (callback: () => void) => number = (callback) => window.requestAnimationFrame(callback),
  cancel: (frame: number) => void = (frame) => window.cancelAnimationFrame(frame),
): () => void {
  const frame = schedule(() => heading?.focus());
  return () => cancel(frame);
}

export function cfpStaleRecoveryState(
  failure: CfpSubmitFailure | null,
  unsavedEdits: boolean,
  lock: Pick<CfpSnapshotLock, "submitted">,
) {
  if (lock.submitted) return null;
  return requiresCfpFormReload(failure) ? { failure, unsavedEdits } : null;
}

export function CfpStaleRecovery({
  failure,
  unsavedEdits,
  onReload,
}: {
  failure: CfpSubmitFailure;
  unsavedEdits: boolean;
  onReload: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => scheduleCfpRecoveryFocus(heading.current), []);
  return (
    <section className="cfp-step cfp-stale-recovery" role="alert" aria-labelledby="cfp-stale-heading">
      <h2 id="cfp-stale-heading" ref={heading} data-cfp-step-heading tabIndex={-1}>Form updated</h2>
      <p>{failure.message}</p>
      <p>Reloading restores only the last saved draft. Any newer edits will be discarded.</p>
      {unsavedEdits && <p><strong>Changes are not saved.</strong> Your most recent edits could not be saved.</p>}
      <Button type="button" variant="secondary" onClick={onReload}>Reload updated form</Button>
    </section>
  );
}

export async function saveWithRetry(
  save: () => Promise<RequestResult>,
  onState: (state: AutosaveState) => void,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
  onFailure?: (failure: RequestResult) => void,
): Promise<boolean> {
  let failure: RequestResult | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    onState(attempt === 0 ? "saving" : "retrying");
    const result = await save();
    if (result.ok) {
      onState("saved");
      return true;
    }
    failure = result;
    if (!result.retryable || attempt === 2) break;
    await wait(250 * (2 ** attempt));
  }
  onState("failed");
  if (failure) onFailure?.(failure);
  return false;
}

export function saveCfpDraftWithRecovery(
  save: () => Promise<RequestResult>,
  lock: CfpSnapshotLock,
  onState: (state: AutosaveState) => void,
  onStale: (failure: Extract<CfpSubmitFailure, { kind: "stale" }>) => void,
  wait?: (milliseconds: number) => Promise<void>,
): Promise<boolean> {
  return saveWithRetry(save, (state) => {
    if (!lock.submitted) onState(state);
  }, wait, (result) => {
    if (lock.submitted) return;
    const failure = cfpSubmitFailure(result);
    if (!requiresCfpFormReload(failure)) return;
    if (!lockStaleCfpSnapshot(lock)) return;
    onStale(failure);
  });
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
  const [coSpeakerErrors, setCoSpeakerErrors] = useState<Record<string, Record<string, string>>>({});
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"status" | "error">("status");
  const [busy, setBusy] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [coSpeakers, setCoSpeakers] = useState<ParticipantDraft[]>([]);
  const [saveState, setSaveState] = useState<AutosaveState>("idle");
  const [result, setResult] = useState<{ code: number } | null>(null);
  const [submitFailure, setSubmitFailure] = useState<CfpSubmitFailure | null>(null);
  const [staleUnsavedEdits, setStaleUnsavedEdits] = useState(false);
  const flowSteps = cfpFlowSteps(form.collectParticipants);
  const enabledSecondaryRoles = enabledSecondaryParticipantRoles(form.participantRoles);
  const portalHref = `/portal/${encodeURIComponent(event.slug)}`;
  /**
   * Closed the moment submit is in flight. Submit promotes the draft row in
   * place, so a debounced PATCH that lands after it has no draft left to write
   * to and comes back 404 — a console error on an otherwise successful
   * submission. An ordinary rejection reopens it because the speaker can keep
   * editing; a stale-version rejection locks this snapshot until a full reload.
   */
  const snapshotLock = useRef<CfpSnapshotLock>({ submitting: false, versionStale: false, submitted: false });
  const nextCoSpeaker = useRef(1);
  const stepRegion = useRef<HTMLElement>(null);
  const previousStep = useRef<Step>(step);
  const previousCodeRequested = useRef(codeRequested);
  const emailInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const deferredAutosave = useRef<ReturnType<typeof createDeferredCfpAutosave<AutosaveSnapshot>> | null>(null);
  deferredAutosave.current ??= createDeferredCfpAutosave<AutosaveSnapshot>();
  const autosave = useRef<((snapshotState: AutosaveSnapshot) => Promise<boolean>) | null>(null);
  autosave.current ??= serializeAutosaves((snapshotState) => {
    const disposition = cfpAutosaveDisposition(snapshotLock.current);
    if (disposition === "fail") {
      setSaveState("failed");
      setStaleUnsavedEdits(true);
      return Promise.resolve(false);
    }
    if (disposition === "discard") return Promise.resolve(true);
    if (disposition === "defer") return Promise.resolve(deferredAutosave.current?.defer(snapshotState, setSaveState) ?? false);
    const participants = snapshotState.participants
      .map((participant, index) => ({
        clientId: participant.clientId,
        email: participantEmail(snapshot, participant.answers),
        answers: participant.answers,
        role: participant.role,
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
    return saveCfpDraftWithRecovery(
      () => cfpRequest(`/api/internal/forms/${form.id}/draft`, {
        formVersion: snapshot.version,
        answers: snapshotState.answers,
        participants,
      }, "PATCH"),
      snapshotLock.current,
      setSaveState,
      (failure) => {
        setStaleUnsavedEdits(true);
        setSubmitFailure(failure);
      },
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

  function showNotice(message: string, kind: "status" | "error" = "status") {
    setSubmitFailure(preserveStaleCfpFailure);
    setNotice(message);
    setNoticeKind(kind);
  }

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    const frame = window.requestAnimationFrame(() => {
      stepRegion.current?.querySelector<HTMLElement>("[data-cfp-step-heading]")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  useEffect(() => {
    if (previousCodeRequested.current === codeRequested) return;
    previousCodeRequested.current = codeRequested;
    const frame = window.requestAnimationFrame(() => {
      focusCfpAccountControl(codeRequested, emailInput.current, codeInput.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [codeRequested]);

  useEffect(() => {
    if (Object.keys(errors).length === 0 && Object.values(coSpeakerErrors).every((participantErrors) => Object.keys(participantErrors).length === 0)) return;
    const frame = window.requestAnimationFrame(() => {
      stepRegion.current?.querySelector<HTMLElement>(
        '[aria-invalid="true"], .field--error [contenteditable="true"], .field--error button, .field--error input, .field--error select, .field--error textarea',
      )?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [coSpeakerErrors, errors]);

  useEffect(() => schedulePortalRedirect(
    step === "done" && form.autoRedirectToPortal,
    () => window.location.assign(portalHref),
  ), [form.autoRedirectToPortal, portalHref, step]);

  useEffect(() => {
    if (!draftId) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      void autosave.current?.({ answers: { ...answers }, participants: [...coSpeakers] });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [answers, coSpeakers, draftId]);

  async function requestCode() {
    setBusy(true);
    showNotice("");
    const sent = await cfpRequest("/api/internal/auth/portal/request", { eventSlug: event.slug, email: email.trim().toLowerCase() });
    setBusy(false);
    if (!sent.ok) { showNotice(sent.message, "error"); return; }
    // The preview surfaces the issued code inline; production never does, which
    // is why this is read from the response rather than assumed.
    const fallback = sent.data.fallback as { otp?: string } | undefined;
    setFallbackOtp(fallback?.otp ?? null);
    setCodeRequested(true);
    showNotice(String(sent.data.message ?? "We sent you a code"));
  }

  async function verifyAndStart() {
    setBusy(true);
    showNotice("");
    const verified = await cfpRequest("/api/internal/auth/portal/verify", { eventSlug: event.slug, email: email.trim().toLowerCase(), code });
    if (!verified.ok) { setBusy(false); showNotice(verified.message, "error"); return; }

    // The draft exists from this moment, pinned to the version being rendered.
    const draft = await cfpRequest(`/api/internal/forms/${form.id}/draft`, { formVersion: snapshot.version });
    setBusy(false);
    if (!draft.ok) { showNotice(draft.message, "error"); return; }
    setDraftId(String(draft.data.submissionId));
    const restored = (draft.data.answers ?? {}) as Answers;
    const restoredParticipants = Array.isArray(draft.data.participants)
      ? draft.data.participants as Array<{ clientId?: unknown; role?: unknown; answers?: unknown }>
      : [];
    setCoSpeakers(restoredParticipants
      .flatMap((participant) => {
        const role = secondaryParticipantRoleSchema.safeParse(participant.role);
        if (
          typeof participant.clientId !== "string"
          || !participant.answers
          || typeof participant.answers !== "object"
          || !role.success
          || !enabledSecondaryRoles.includes(role.data)
        ) return [];
        return [{ clientId: participant.clientId, role: role.data, answers: participant.answers as Answers }];
      }));
    setDraftRestored(Object.keys(restored).length > 0 || restoredParticipants.length > 0);
    const emailField = snapshot.sections.flatMap((section) => section.fields).find((field) => field.key === "email");
    setAnswers((current) => ({
      ...restored,
      ...current,
      ...(emailField ? { [emailField.id]: { t: "s", v: email.trim().toLowerCase() } as const } : {}),
    }));
    setStep("submission");
  }

  function continueFromSubmission() {
    const next = stepFieldErrors(snapshot, ["abstract"], answers);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      showNotice("Some submission answers need attention before continuing", "error");
      return;
    }
    showNotice("");
    setStep(form.collectParticipants ? "speaker" : "review");
  }

  function continueFromSpeaker() {
    const primaryErrors = stepFieldErrors(snapshot, ["participant"], answers);
    const participantErrors = Object.fromEntries(coSpeakers.map((participant) => [
      participant.clientId,
      stepFieldErrors(snapshot, ["participant"], participant.answers, answers),
    ]));
    setErrors(primaryErrors);
    setCoSpeakerErrors(participantErrors);
    const hasErrors = Object.keys(primaryErrors).length > 0
      || Object.values(participantErrors).some((next) => Object.keys(next).length > 0);
    if (hasErrors) {
      showNotice("Some speaker details need attention before reviewing", "error");
      return;
    }
    showNotice("");
    setStep("review");
  }

  function addParticipant(role: SecondaryParticipantRole) {
    const number = nextCoSpeaker.current;
    nextCoSpeaker.current += 1;
    setCoSpeakers((current) => [...current, { clientId: `${role.replaceAll("_", "-")}-${number}`, role, answers: {} }]);
  }

  function updateCoSpeaker(clientId: string, fieldId: FieldId, value: AnswerValue | undefined) {
    setCoSpeakers((current) => current.map((participant) => (
      participant.clientId === clientId
        ? { ...participant, answers: { ...participant.answers, [fieldId]: value } }
        : participant
    )));
    setCoSpeakerErrors((current) => ({
      ...current,
      [clientId]: Object.fromEntries(Object.entries(current[clientId] ?? {}).filter(([existingFieldId]) => existingFieldId !== fieldId)),
    }));
  }

  function removeCoSpeaker(clientId: string) {
    setCoSpeakers((current) => current.filter((participant) => participant.clientId !== clientId));
    setCoSpeakerErrors((current) => Object.fromEntries(Object.entries(current).filter(([participantId]) => participantId !== clientId)));
  }

  async function submit() {
    if (!beginCfpSubmit(snapshotLock.current)) return;
    setBusy(true);
    setErrors({});
    setCoSpeakerErrors({});
    setNotice("");
    setSubmitFailure(null);
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
      abortCfpSubmit(snapshotLock.current);
      setBusy(false);
      showNotice("Each additional participant needs a unique email address", "error");
      setStep("speaker");
      return;
    }
    const sent = await cfpRequest(`/api/internal/forms/${form.id}/submit`, {
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
        role: participant.role,
        isPrimary: false,
        sortOrder,
        answers: Object.fromEntries(Object.entries(participant.answers).filter(([fieldId]) => participantIds.has(fieldId as FieldId))),
      }))],
    });
    setBusy(false);
    if (!sent.ok) {
      const failure = cfpSubmitFailure(sent);
      const deferredEdits = deferredAutosave.current?.hasPending() ?? false;
      settleCfpSubmitFailure(snapshotLock.current, failure);
      const settlement = requiresCfpFormReload(failure) ? "stale-failure" : "ordinary-failure";
      void deferredAutosave.current?.settle(
        settlement,
        (snapshotState) => autosave.current?.(snapshotState) ?? Promise.resolve(false),
      );
      // A stale version stays closed to submit and autosave until the fresh
      // page loads. Mark any locally queued write as unsaved before rendering
      // the read-only recovery state.
      if (requiresCfpFormReload(failure)) {
        setSaveState("failed");
        setStaleUnsavedEdits(deferredEdits || saveState !== "saved");
      }
      // Field errors belong next to their fields; anything else is a message.
      if (sent.fieldErrors) {
        const split = splitParticipantFieldErrors(sent.fieldErrors);
        setErrors(split.unscoped);
        setCoSpeakerErrors(split.byParticipant);
        setStep(stepForErrors(snapshot, sent.fieldErrors));
      }
      setSubmitFailure((current) => preserveStaleCfpFailure(current) ?? failure);
      return;
    }
    settleCfpSubmitSuccess(snapshotLock.current);
    void deferredAutosave.current?.settle(
      "success",
      (snapshotState) => autosave.current?.(snapshotState) ?? Promise.resolve(false),
    );
    setSubmitFailure(null);
    setStaleUnsavedEdits(false);
    setResult({ code: Number(sent.data.code) });
    setDraftId(null);
    setStep("done");
  }

  const staleRecovery = cfpStaleRecoveryState(submitFailure, staleUnsavedEdits, snapshotLock.current);
  if (staleRecovery) {
    return <CfpStaleRecovery {...staleRecovery} onReload={() => reloadUpdatedCfpForm()} />;
  }

  if (step === "done" && result) {
    return (
      <section ref={stepRegion} className="cfp-step cfp-step--compact">
        <h2 data-cfp-step-heading tabIndex={-1}>Thank you — your proposal is in</h2>
        {form.successHtml?.trim()
          ? <RichTextView html={form.successHtml} />
          : <p>Your proposal was submitted successfully. Keep the reference code below for your records.</p>}
        <p>Reference <b>SESS-{result.code}</b></p>
        {form.autoRedirectToPortal && <p role="status">Opening your speaker portal in 10 seconds…</p>}
        <a className="button button-primary" href={portalHref}>Open your speaker portal</a>
      </section>
    );
  }

  return (
    <FormUploadProvider eventId={event.id}>
    <section ref={stepRegion} className={`cfp-step${step === "account" ? " cfp-step--compact" : ""}`}>
      <ol className="public-form-progress" aria-label="Submission progress">
        {flowSteps.map((name) => (
          <li key={name} className={step === name ? "active" : ""} aria-current={step === name ? "step" : undefined}>{name}</li>
        ))}
      </ol>

      {step === "account" && (
        <>
        <h2 data-cfp-step-heading tabIndex={-1}>{cfpStepHeading(snapshot, step)}</h2>
        <form className="form-grid cfp-account-form" onSubmit={(event) => { event.preventDefault(); void (codeRequested ? verifyAndStart() : requestCode()); }}>
          <label className="field">
            <span>Email address</span>
            <input ref={emailInput} type="email" required value={email} onChange={(change) => setEmail(change.target.value)} autoComplete="email" />
          </label>
          {!codeRequested ? (
            <Button type="submit" disabled={busy || email.trim() === ""}>{busy ? "Sending…" : "Send me a code"}</Button>
          ) : (
            <>
              <label className="field">
                <span>Six-digit code</span>
                <input ref={codeInput} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(change) => setCode(change.target.value.replace(/\D/g, "").slice(0, 6))} />
              </label>
              {/* Development diagnostics only — production does not return this. */}
              {fallbackOtp && <p className="demo-code">Development code: <code>{fallbackOtp}</code></p>}
              <div className="cfp-code-actions">
                <Button type="button" variant="ghost" onClick={() => { setCodeRequested(false); setCode(""); }}>Change email</Button>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void requestCode()}>Resend code</Button>
                <Button type="submit" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Continue"}</Button>
              </div>
            </>
          )}
        </form>
        </>
      )}

      {step === "submission" && (
        <form onSubmit={(event) => { event.preventDefault(); continueFromSubmission(); }}>
          <h2 data-cfp-step-heading tabIndex={-1}>{cfpStepHeading(snapshot, step)}</h2>
          {draftRestored && (
            <div className="cfp-draft-resume" role="status">
              <b>Saved draft restored</b>
              <span>Your previous answers are back. Continue when ready.</span>
            </div>
          )}
          <FormFieldRenderer snapshot={snapshot} answers={answers} onChange={onChange} mode="edit" sectionKeys={["abstract"]} errors={errors} />
          <div className="cfp-actions">
            <Button type="submit">Continue</Button>
          </div>
        </form>
      )}

      {form.collectParticipants && step === "speaker" && (
        <form onSubmit={(event) => { event.preventDefault(); continueFromSpeaker(); }}>
          <h2 data-cfp-step-heading tabIndex={-1}>{cfpStepHeading(snapshot, step)}</h2>
          <FormFieldRenderer snapshot={snapshot} answers={answers} onChange={onChange} mode="edit" sectionKeys={["participant"]} errors={errors} />
          {coSpeakers.map((participant, index) => (
            <div className="co-speaker-fields" key={participant.clientId}>
              <div className="review-block__header">
                <h3>{PARTICIPANT_ROLE_LABELS[participant.role]} {coSpeakers.slice(0, index + 1).filter((candidate) => candidate.role === participant.role).length}</h3>
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
                errors={coSpeakerErrors[participant.clientId] ?? {}}
              />
            </div>
          ))}
          {enabledSecondaryRoles.map((role) => (
            <button key={role} type="button" className="add-cospeaker" onClick={() => addParticipant(role)}>
              <b>Add a {PARTICIPANT_ROLE_LABELS[role]}</b>
              <span>Include another person on this proposal.</span>
            </button>
          ))}
          <div className="cfp-actions">
            <Button type="button" variant="secondary" onClick={() => setStep("submission")}>Back</Button>
            <Button type="submit">Review</Button>
          </div>
        </form>
      )}

      {step === "review" && (
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <h2 data-cfp-step-heading tabIndex={-1}>{cfpStepHeading(snapshot, step)}</h2>
          {/* Read-back in review mode: the speaker checks what will be stored,
              which is also where a stale hidden answer would be conspicuous. */}
          <FormFieldRenderer snapshot={snapshot} answers={answers} onChange={onChange} mode="review" />
          {coSpeakers.length > 0 && (
            <div className="review-block">
              <div className="review-block__header"><h3>Additional participants</h3></div>
              {coSpeakers.map((participant, index) => (
                <div className="review-block" key={participant.clientId}>
                  <h4>{PARTICIPANT_ROLE_LABELS[participant.role]} {coSpeakers.slice(0, index + 1).filter((candidate) => candidate.role === participant.role).length}</h4>
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
            <Button type="button" variant="secondary" onClick={() => setStep(form.collectParticipants ? "speaker" : "submission")}>Back</Button>
            <Button type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit proposal"}</Button>
          </div>
        </form>
      )}

      {submitFailure
        ? <CfpSubmitFailureNotice failure={submitFailure} />
        : notice && <p className="cfp-notice" role={noticeKind === "error" ? "alert" : "status"}>{notice}</p>}
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
  const split = splitParticipantFieldErrors(fieldErrors);
  return Object.keys(split.byParticipant).length > 0
    || Object.keys(split.unscoped).some((fieldId) => participantFields.has(fieldId as FieldId))
    ? "speaker"
    : "submission";
}
