"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SubmissionDetailDTO } from "@/shared/contracts";
import type { SubmissionVocabulary } from "@/features/submissions";
import { formatCode } from "@/features/submissions/index.client";
import { SubmissionReviewHistory } from "../evaluation/components/submission-review-history";
import { SubmissionDecisionHistory } from "./submission-decision-history";
import { SubmissionAnswers } from "./submission-answers";
import {
  AbstractFields,
  toPatch,
  type AbstractFieldValues,
} from "./abstract-fields";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { Dash } from "@/shared/ui/app/dash";
import { FlowNavControls } from "@/shared/ui/app/flow-nav-controls";
import { LoadFailure } from "@/shared/ui/app/load-failure";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { SkeletonText } from "@/shared/ui/app/skeleton";
import { StaleWriteNotice, staleWriteConfirm } from "@/shared/ui/app/stale-write";
import { TzTime } from "@/shared/ui/app/tz-time";
import { useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { Button, Drawer, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

type DetailLoadPurpose = "open" | "stale";
type DetailLoadFailure = {
  kind: "transport" | "response";
  message: string;
  retryable: boolean;
};
type DetailLoadState =
  | { status: "loading"; purpose: DetailLoadPurpose }
  | { status: "ready"; purpose: DetailLoadPurpose }
  | { status: "failed"; purpose: DetailLoadPurpose; failure: DetailLoadFailure };

type DetailPayload = {
  data?: SubmissionDetailDTO;
  error?: { code?: string; message?: string };
};

const TERMINAL_DETAIL_CODES = new Set(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"]);

function responseFailure(response: Response, payload: DetailPayload | null, purpose: DetailLoadPurpose): DetailLoadFailure {
  const code = payload?.error?.code;
  const terminal = response.status === 401
    || response.status === 403
    || response.status === 404
    || (code !== undefined && TERMINAL_DETAIL_CODES.has(code));
  return {
    kind: "response",
    message: payload?.error?.message ?? (purpose === "stale"
      ? "The latest version could not be loaded. Try again."
      : "Could not load this submission. Try again."),
    retryable: !terminal,
  };
}

function transportFailure(purpose: DetailLoadPurpose): DetailLoadFailure {
  return {
    kind: "transport",
    message: purpose === "stale"
      ? "The latest version couldn’t be loaded. Check your connection and retry."
      : "Could not load this submission. Check your connection and try again.",
    retryable: true,
  };
}

/**
 * The submission a reviewer opens. Answers render through the *pinned* snapshot,
 * so a question renamed after submission still reads the way the speaker
 * answered it — labels are read from the version they saw, not from the form as
 * it looks today.
 *
 * The Details fields are editable and every save carries the `row_version` the
 * drawer loaded. Two organizers with the same submission open is the normal
 * case, not the exotic one; the second save is refused with 409 rather than
 * silently reverting the first.
 */
function toValues(detail: SubmissionDetailDTO, vocabulary: SubmissionVocabulary): AbstractFieldValues {
  return {
    title: detail.title,
    descriptionHtml: detail.descriptionHtml ?? "",
    trackId: detail.trackId ?? "",
    // The DTO carries the format's *name* for display, not its id, and format
    // names are unique per event — so the select is resolved by name rather than
    // by adding a column to a contract four other modules read.
    formatId: vocabulary.formats.find((format) => format.name === detail.formatName)?.id ?? "",
    level: detail.level ?? "",
    language: detail.language ?? "",
    capacity: detail.capacity === null ? "" : String(detail.capacity),
    clientSessionId: detail.clientSessionId ?? "",
    startsAt: detail.startsAt,
    endsAt: detail.endsAt,
    tagIds: detail.tags.map((tag) => tag.id),
  };
}

export function SubmissionDrawer({
  eventId,
  submissionId,
  timezone,
  vocabulary,
  canEdit = false,
  onClose,
  nav,
  onBusyChange,
}: {
  eventId: string;
  submissionId: string;
  timezone: string;
  vocabulary: SubmissionVocabulary;
  canEdit?: boolean;
  onClose: () => void;
  /** M57 — keyboard/click next-prev across the table's current rows. */
  nav?: { index: number; total: number; itemLabel?: string | undefined; onPrev?: (() => void) | undefined; onNext?: (() => void) | undefined };
  /** Prevent the parent keyboard flow from leaving while this drawer is saving. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [detail, setDetail] = useState<SubmissionDetailDTO | null>(null);
  const [loadState, setLoadState] = useState<DetailLoadState>({ status: "loading", purpose: "open" });
  const [values, setValues] = useState<AbstractFieldValues | null>(null);
  const [original, setOriginal] = useState<AbstractFieldValues | null>(null);
  const [rowVersion, setRowVersion] = useState<number | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<{ kind: "error" | "status"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** A refused row version, waiting for the organizer to agree to be overwritten. */
  const [staleWrite, setStaleWrite] = useState(false);
  const [confirmingLoadLatest, setConfirmingLoadLatest] = useState(false);
  /** Bumped to re-run the loader for the *same* submission — `router.refresh()`
   * re-renders the server tree but cannot reach this client-side fetch, so a
   * stale-write conflict needs its own reload signal. */
  const [reloadToken, setReloadToken] = useState(0);
  /** The effect deliberately does not depend on load state: this ref records
   * whether a token asks for an ordinary open or recovery after a refused row
   * version, without rebuilding the event-scoped vocabulary into a dependency. */
  const loadPurpose = useRef<DetailLoadPurpose>("open");

  /** Which submission the drawer is showing *now*. `save()` is async and this
   * component is not remounted between submissions (the parent swaps the id
   * while the drawer stays open), so a PATCH for the one the organizer just
   * left must not write its answer into the one they are now reading. */
  const active = useRef({ eventId, submissionId });

  // Blanking belongs to *opening a different submission*, not to reloading the
  // one on screen: a reload after a 409 has to keep the message explaining why
  // it is reloading, which the loader below would otherwise clear out from under
  // the organizer.
  useEffect(() => {
    active.current = { eventId, submissionId };
    loadPurpose.current = "open";
    setDetail(null);
    setLoadState({ status: "loading", purpose: "open" });
    setSaveFeedback(null);
    setValues(null);
    setOriginal(null);
    setRowVersion(null);
    setBusy(false);
    setStaleWrite(false);
    setConfirmingLoadLatest(false);
  }, [eventId, submissionId]);

  useEffect(() => {
    let cancelled = false;
    const purpose = loadPurpose.current;
    setLoadState({ status: "loading", purpose });
    fetch(`/api/internal/submissions/${eventId}/${submissionId}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as DetailPayload | null;
        if (cancelled) return;
        if (!response.ok || !payload?.data) {
          const failure = responseFailure(response, payload, purpose);
          setLoadState({ status: "failed", purpose, failure });
          if (purpose === "stale") {
            setSaveFeedback(null);
            // A terminal response is authoritative: the row is gone or this
            // organizer may no longer read it, so do not leave its old detail
            // and identity-bearing fields on screen.
            if (!failure.retryable) {
              setDetail(null);
              setValues(null);
              setOriginal(null);
              setRowVersion(null);
            }
          }
          return;
        }
        setDetail(payload.data);
        setValues(toValues(payload.data, vocabulary));
        setOriginal(toValues(payload.data, vocabulary));
        setRowVersion(payload.data.rowVersion);
        setLoadState({ status: "ready", purpose });
        setSaveFeedback(purpose === "stale"
          ? { kind: "status", message: "Latest version loaded. Re-apply your edit, then save." }
          : null);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState({ status: "failed", purpose, failure: transportFailure(purpose) });
        if (purpose === "stale") setSaveFeedback(null);
      });
    // A reviewer clicking down a list opens several in a row; a late response
    // for one they have already moved past must not replace what they are reading.
    return () => { cancelled = true; };
    // `vocabulary` is intentionally excluded: it is an event-scoped object rebuilt
    // with a fresh identity on every server render (the page is force-dynamic), so
    // including it would re-run this loader on every router.refresh() — wiping the
    // organizer's unsaved edits on refreshes that have nothing to do with them.
    // `reloadToken` is how a reload is asked for deliberately instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, submissionId, reloadToken]);

  const patch = values && original ? toPatch(values, original) : {};
  const dirty = Object.keys(patch).length > 0;
  // A failed recovery keeps the old draft visible so it can be re-applied, but
  // never makes the rejected row version writable again. Navigation itself is
  // blocked only while a request is active; once a retry fails, the ordinary
  // unsaved-work guard can safely handle Close/next/previous.
  const staleReloadPending = loadState.purpose === "stale" && loadState.status !== "ready";
  const staleRecoveryRequired = staleWrite || staleReloadPending;
  // While the notice is only *offering* to load the latest version the fields
  // stay editable — that draft is the organizer's last copy of what they wrote,
  // and freezing it takes away their chance to lift it out before it is
  // replaced. Saving is what stops; the row version is what is refused.
  const fieldsLocked = busy || staleReloadPending;
  const interactionLocked = busy || (loadState.status === "loading" && loadState.purpose === "stale");
  useUnsavedWorkGuard(dirty);

  useEffect(() => {
    onBusyChange?.(interactionLocked);
  }, [interactionLocked, onBusyChange]);

  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  /** The confirmed half of the stale-write pattern: replace the draft with what is saved. */
  function loadLatest() {
    setStaleWrite(false);
    setConfirmingLoadLatest(false);
    setSaveFeedback({ kind: "status", message: "Loading the latest version…" });
    loadPurpose.current = "stale";
    setLoadState({ status: "loading", purpose: "stale" });
    setReloadToken((token) => token + 1);
    // The reload has to be explicit — `router.refresh()` alone leaves this
    // drawer holding the same fields and the same row version, so every retry
    // would keep conflicting until it was closed and reopened.
    router.refresh();
  }

  function retryLoad() {
    if (loadState.status !== "failed" || !loadState.failure.retryable) return;
    loadPurpose.current = loadState.purpose;
    setLoadState({ status: "loading", purpose: loadState.purpose });
    if (loadState.purpose === "stale") {
      setSaveFeedback({ kind: "status", message: "This submission changed since you opened it. Loading the latest version…" });
    }
    setReloadToken((token) => token + 1);
  }

  async function save() {
    if (!values || !original || rowVersion === null || staleRecoveryRequired) return;
    const request = { eventId, submissionId };
    setBusy(true);
    setSaveFeedback(null);
    try {
      const response = await fetch(`/api/internal/submissions/${eventId}/${submissionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRowVersion: rowVersion, patch }),
      });
      const payload = await response.json().catch(() => null) as {
        data?: { rowVersion: number };
        error?: { code?: string; message?: string };
      } | null;
      // The organizer can walk to the next abstract (or close the drawer) while
      // this is in flight. Every branch below writes state that belongs to the
      // submission this request was for, so a late answer for one they have
      // left is dropped rather than stamped onto the one they are reading.
      if (active.current.eventId !== request.eventId || active.current.submissionId !== request.submissionId) return;
      if (response.status === 409 || payload?.error?.code === "STALE_WRITE") {
        // Not an error the organizer caused, and not one they can fix by
        // pressing Save again: their copy is behind. This used to reload the
        // latest version on the spot, which overwrote everything they had
        // typed and then asked them to type it again from memory. It now
        // raises the shared stale-write notice instead: the draft stays on
        // screen, and the replacement happens only once they say so.
        setSaveFeedback(null);
        setStaleWrite(true);
        return;
      }
      if (!response.ok || !payload?.data) {
        setSaveFeedback({ kind: "error", message: payload?.error?.message ?? "That did not save" });
        return;
      }
      setRowVersion(payload.data.rowVersion);
      setOriginal(values);
      // The PATCH answers with the new row version and nothing else, but the
      // header reads `detail` — without this a saved title goes on showing the
      // old one for as long as the drawer stays open.
      setDetail((current) => current && { ...current, title: values.title });
      toast("Submission saved");
      router.refresh();
    } catch {
      // A dropped connection rejects rather than answering, so none of the
      // branches above run. Without this the button just flips back to "Save
      // changes" and nothing says the edit was never written.
      if (active.current.eventId !== request.eventId || active.current.submissionId !== request.submissionId) return;
      setSaveFeedback({ kind: "error", message: "Could not reach the server. This abstract was not saved." });
    } finally {
      // Same rule as above, for the same reason: if the drawer has moved on,
      // `busy` now belongs to whatever is saving *there* and this request has no
      // business clearing it. The submission it does belong to was reset when
      // the drawer switched away.
      if (active.current.eventId === request.eventId && active.current.submissionId === request.submissionId) setBusy(false);
    }
  }

  return (
    <>
    <Drawer
      open
      onClose={onClose}
      title={detail ? formatCode(detail.code) : "Submission"}
      {...(nav ? { headerExtra: <FlowNavControls index={nav.index} total={nav.total} itemLabel={nav.itemLabel} itemNoun="submission" onPrev={nav.onPrev} onNext={nav.onNext} /> } : {})}
    >
      {loadState.status === "failed" && (
        <LoadFailure
          message={loadState.failure.message}
          {...(loadState.failure.retryable ? { onRetry: retryLoad } : {})}
        />
      )}
      {staleWrite && <StaleWriteNotice subject="submission" busy={busy} onLoadLatest={() => setConfirmingLoadLatest(true)} />}
      {!detail && loadState.status === "loading" && (
        <SkeletonText lines={6} label={loadState.purpose === "stale" ? "Loading the latest version…" : "Loading submission…"} />
      )}
      {detail && (
        <div className="submission-drawer">
          <header className="drawer-hero">
            <StatusBadge value={detail.status} />
            <h2>{detail.title}</h2>
            <p>
              {detail.submittedAt
                ? <>Submitted <TzTime instant={detail.submittedAt} tz={timezone} style="long" /></>
                : <>Not submitted</>}
            </p>
          </header>

          <div className="drawer-content">
            <section>
              <h3>Speakers</h3>
              <ul className="portal-participants">
                {detail.participants.map((participant) => (
                  <li key={participant.id}>
                    <b>{participant.name}</b>
                    <span>{participant.email}</span>
                    {participant.isPrimary && <em>Primary contact</em>}
                  </li>
                ))}
              </ul>
            </section>

            {canEdit && values && (
              <section>
                <h3>Details</h3>
                {saveFeedback && <p className="portal-note" role={saveFeedback.kind === "error" ? "alert" : "status"}>{saveFeedback.message}</p>}
                <AbstractFields
                  values={values}
                  onChange={setValues}
                  vocabulary={vocabulary}
                  timezone={timezone}
                  disabled={fieldsLocked}
                />
                <div className="drawer-actions">
                  <Button disabled={fieldsLocked || staleRecoveryRequired || !dirty} onClick={save}>
                    {busy ? "Saving…" : staleRecoveryRequired ? "Latest version required" : "Save changes"}
                  </Button>
                </div>
              </section>
            )}

            {!canEdit && (
              <section>
                <h3>Description</h3>
                {detail.descriptionHtml ? <RichTextView html={detail.descriptionHtml} /> : <Dash />}
              </section>
            )}

            <section>
              <h3>Answers</h3>
              <SubmissionAnswers data={detail.answerPanel} />
            </section>

            {canEdit && (
              <>
                <SubmissionReviewHistory eventId={eventId} submissionId={submissionId} timezone={timezone} />
                <SubmissionDecisionHistory eventId={eventId} submissionId={submissionId} timezone={timezone} />
              </>
            )}
          </div>
        </div>
      )}
    </Drawer>
    <ConfirmDialog
      open={confirmingLoadLatest}
      {...staleWriteConfirm("submission")}
      onConfirm={loadLatest}
      onCancel={() => setConfirmingLoadLatest(false)}
    />
    </>
  );
}
