import { db, type DbOrTx } from "@/db/client";
import { validateTemplateBody } from "@/features/comms";
import type { EventId, FormId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import type { BuilderForm, FormPatch } from "../builder-types";
import { getFormForBuilderIn } from "./builder-queries";
import { updateFormIn } from "./builder-mutations";

export type SettingsPatch = Pick<FormPatch,
  | "status"
  | "opensAt"
  | "closesAt"
  | "submissionLimit"
  | "successHtml"
  | "autoRedirectToPortal"
>;

export type NotificationsPatch = Pick<FormPatch,
  | "sendConfirmation"
  | "confirmationSubject"
  | "confirmationBodyHtml"
>;

const SUBMISSION_LIMIT_MIN = 1;
const SUBMISSION_LIMIT_MAX = 50;

/**
 * "Counts submitted sessions only — saved drafts don't use up the limit" is
 * the binding copy (the real product's "includes saved drafts" line is wrong
 * for us — drafts never consume the limit here, see `submissions/server/
 * mutations.ts#assertUnderLimit`). 1..50 matches the number input's own
 * min/max; rejecting out-of-range here as well means a hand-built request
 * cannot store a limit the UI would never let an organizer type.
 *
 * Exported (not just called from `saveSettingsStepIn`) so the single generic
 * `PATCH /api/internal/forms/[formId]` route — every builder step's save path,
 * not only Settings — can run it too: a request that reaches that route
 * straight from `fetch`, bypassing this module entirely, must not be able to
 * store a limit the UI would never let an organizer type.
 */
export function assertValidSubmissionLimit(limit: number | null | undefined): void {
  if (limit === undefined || limit === null) return;
  if (!Number.isInteger(limit) || limit < SUBMISSION_LIMIT_MIN || limit > SUBMISSION_LIMIT_MAX) {
    throw new AppError("VALIDATION", `Submission limit must be a whole number between ${SUBMISSION_LIMIT_MIN} and ${SUBMISSION_LIMIT_MAX}`);
  }
}

/**
 * The Notifications step's variable check (see `saveNotificationsStepIn`
 * below), factored out so the shared PATCH route can run it on every write
 * that touches `confirmationSubject`/`confirmationBodyHtml` — R2 boundary #6
 * is "validated at save time", and the save time that matters is whichever
 * code path actually reaches the database, not just this module's own entry
 * point.
 */
export async function assertValidConfirmationTemplate(
  dbOrTx: DbOrTx,
  eventId: EventId,
  formId: FormId,
  patch: Pick<NotificationsPatch, "confirmationSubject" | "confirmationBodyHtml">,
): Promise<void> {
  if (patch.confirmationSubject === undefined && patch.confirmationBodyHtml === undefined) return;
  const current = await getFormForBuilderIn(dbOrTx, eventId, formId);
  const subject = patch.confirmationSubject ?? current.confirmationSubject;
  const bodyHtml = patch.confirmationBodyHtml ?? current.confirmationBodyHtml;
  const validation = validateTemplateBody("submission_received", subject, bodyHtml);
  if (!validation.ok) {
    throw new AppError(
      "TEMPLATE_VAR_MISSING",
      `Unknown variable ${validation.unknownTokens.map((token) => `{{${token}}}`).join(", ")} — remove it, or leave the field blank to use the event's default template`,
      { unknownTokens: validation.unknownTokens },
    );
  }
}

/**
 * Deadlines + submission capacity + after-submission copy — the "Settings"
 * step (catalog cards: Deadlines, Submission capacity, After submission).
 *
 * `opensAt`/`closesAt` arrive already converted to UTC instants: the
 * `<DateTimePicker tz>` control (`close-date-card.tsx`) does that conversion
 * client-side via `zonedInputToUtc`/`endOfDayInTz` (`time.ts`), including the
 * date-only → end-of-day rule, so there is nothing left to convert here — this
 * function validates and persists. The authoritative open/close decision at
 * submit time is still the SQL `is_form_open()` predicate against the
 * database clock (S2); this only stores the organizer's intent.
 *
 * One save = one new immutable form-version, via `updateFormIn`'s existing
 * snapshot recompilation — settings never touch field/section shape, so the
 * recompiled snapshot is byte-identical except for its version number. That
 * keeps "one save, one version" simple rather than special-casing
 * non-structural saves.
 */
export async function saveSettingsStepIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  formId: FormId,
  patch: SettingsPatch,
  expectedUpdatedAt: string,
): Promise<BuilderForm> {
  assertValidSubmissionLimit(patch.submissionLimit);
  return updateFormIn(dbOrTx, eventId, formId, patch, expectedUpdatedAt);
}

export function saveSettingsStep(
  eventId: EventId,
  formId: FormId,
  patch: SettingsPatch,
  expectedUpdatedAt: string,
): Promise<BuilderForm> {
  return saveSettingsStepIn(db, eventId, formId, patch, expectedUpdatedAt);
}

/**
 * Submission Confirmation — the per-form override of the event-level
 * `submission_received` template that M34's dispatcher reads
 * (`comms/server/context.ts#buildContext`: a non-empty `confirmationSubject`
 * or `confirmationBodyHtml` becomes `templateOverride`).
 *
 * Variables are validated at **save** time against the same allowlist that
 * gates the event-level template (R2 boundary #6 — a send-time `undefined` in
 * a judge's inbox is a P0), and subject + body are checked **together**: a
 * save that only patches one of the two still validates the pair, so fixing
 * the subject cannot leave a bad token sitting unnoticed in the stored body.
 * `updateFormIn` sanitizes the body HTML on the same write.
 */
export async function saveNotificationsStepIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  formId: FormId,
  patch: NotificationsPatch,
  expectedUpdatedAt: string,
): Promise<BuilderForm> {
  await assertValidConfirmationTemplate(dbOrTx, eventId, formId, patch);
  return updateFormIn(dbOrTx, eventId, formId, patch, expectedUpdatedAt);
}

export function saveNotificationsStep(
  eventId: EventId,
  formId: FormId,
  patch: NotificationsPatch,
  expectedUpdatedAt: string,
): Promise<BuilderForm> {
  return saveNotificationsStepIn(db, eventId, formId, patch, expectedUpdatedAt);
}
