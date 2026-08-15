/**
 * The pure TS twin of `is_form_open(form_id uuid)` (drizzle/0001_views_triggers.sql).
 * Used for banners, the forms-list status pill, and friendly pre-checks — the
 * SQL function inside the submit transaction remains the only authority (S2:
 * deadline enforcement is SQL, not JS). This file exists so both sides agree on
 * the boundary; it is exercised against a seeded closed form in Step 1's
 * "Done when" alongside a direct `is_form_open()` call.
 *
 * Isomorphic and side-effect free: takes `nowIso` rather than reading the
 * clock, and compares raw instants only — no timezone conversion happens here
 * (that already happened when `opensAt`/`closesAt` were written as UTC
 * instants), so nothing in this file needs `time.ts` or a date library.
 */
export type FormOpenReason = "ok" | "not_open_yet" | "closed_by_date" | "closed_by_admin";

export type FormOpenStatus = "draft" | "open" | "closed";

export type FormAvailability = "draft" | "scheduled" | "live" | "ended" | "closed";

export type FormAvailabilityAction = "open" | "close";

export type FormAvailabilityActionCopy = {
  title: string;
  body: string;
  confirmLabel: string;
};

export function formAvailabilityActionLabel(
  storedStatus: FormOpenStatus,
  availability: FormAvailability,
): string {
  if (storedStatus !== "open") return "Open form";
  if (availability === "scheduled") return "Cancel scheduled opening";
  if (availability === "ended") return "Set form to closed";
  return "Stop accepting submissions";
}

export function formOpenState(
  form: { status: FormOpenStatus; opensAt: string | null; closesAt: string | null },
  nowIso: string,
): { open: boolean; reason: FormOpenReason } {
  // The status column stores admin intent and outranks the dates in the
  // closing direction: a draft or admin-closed form never reads as open, no
  // matter what opens_at/closes_at say. This mirrors is_form_open's
  // `status = 'open' AND ...` short-circuit.
  if (form.status !== "open") return { open: false, reason: "closed_by_admin" };

  const now = new Date(nowIso).getTime();

  // opens_at <= now() in SQL — equality already counts as open.
  if (form.opensAt !== null && now < new Date(form.opensAt).getTime()) {
    return { open: false, reason: "not_open_yet" };
  }

  // closes_at > now() in SQL — equality already counts as closed, so the
  // comparison here is intentionally >= rather than >.
  if (form.closesAt !== null && now >= new Date(form.closesAt).getTime()) {
    return { open: false, reason: "closed_by_date" };
  }

  return { open: true, reason: "ok" };
}

/**
 * Organizer-facing label for the same state enforced by `formOpenState`.
 * `status` remains the stored publishing intent; availability explains what
 * that intent plus the configured window means right now.
 */
export function formAvailability(
  form: { status: FormOpenStatus; opensAt: string | null; closesAt: string | null },
  nowIso: string,
): FormAvailability {
  if (form.status === "draft") return "draft";

  const openState = formOpenState(form, nowIso);
  if (openState.open) return "live";
  if (openState.reason === "not_open_yet") return "scheduled";
  if (openState.reason === "closed_by_date") return "ended";
  return "closed";
}

/**
 * Is this form still part of an open call — accepting submissions now, or
 * waiting for its opening date?
 *
 * Read this rather than `forms.status`. Nothing flips that column when
 * `closes_at` elapses (`0038_form_open_wall_clock.sql` compares against
 * `clock_timestamp()` instead), so the ordinary end state of every call for
 * speakers is `status = 'open'` with a close date in the past. Consumers that
 * test the column directly therefore never observe a CFP ending.
 */
export function formAcceptsOrWillAccept(availability: FormAvailability): boolean {
  return availability === "live" || availability === "scheduled";
}

/** Honest preflight copy for the builder's consequential availability action. */
export function formAvailabilityActionCopy(
  action: FormAvailabilityAction,
  form: { opensAt: string | null; closesAt: string | null },
  nowIso: string,
): FormAvailabilityActionCopy {
  const availability = formAvailability({ status: "open", ...form }, nowIso);
  if (action === "close") {
    if (availability === "scheduled") {
      return {
        title: "Cancel this scheduled opening?",
        body: "This keeps the public form unavailable and cancels its scheduled opening. You can reopen or reschedule it later.",
        confirmLabel: "Cancel scheduled opening",
      };
    }
    if (availability === "ended") {
      return {
        title: "Set this ended form to closed?",
        body: "The closing time has already passed, so the form is not accepting submissions. This records it as closed until you reopen it.",
        confirmLabel: "Set form to closed",
      };
    }
    return {
      title: "Stop accepting submissions now?",
      body: "This immediately stops new submissions. People with in-progress drafts will not be able to submit them until you reopen the form.",
      confirmLabel: "Stop accepting submissions",
    };
  }

  if (availability === "scheduled") {
    return {
      title: "Schedule this form to open?",
      body: "This publishes the saved form and starts accepting submissions at its saved opening time. Until then, the public form remains unavailable.",
      confirmLabel: "Schedule form",
    };
  }
  if (availability === "ended") {
    return {
      title: "Set this ended form to open?",
      body: "The saved closing time has already passed, so the form will remain unavailable. Update its schedule if you want to accept submissions again.",
      confirmLabel: "Set status to open",
    };
  }
  return {
    title: "Open this form now?",
    body: "This publishes the saved form and immediately starts accepting submissions through its public link.",
    confirmLabel: "Open form",
  };
}

/**
 * The form's own limit wins; the event's per-user cap is what it falls back to
 * when the organizer never set a form-level limit. Drafts never count toward
 * either number — that rule lives at the call site that counts submissions,
 * not here.
 */
export function effectiveLimit(
  form: { submissionLimit: number | null },
  event: { submissionCapPerUser: number },
): number {
  return form.submissionLimit ?? event.submissionCapPerUser;
}
