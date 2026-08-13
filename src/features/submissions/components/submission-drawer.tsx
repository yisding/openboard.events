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
import { Dash } from "@/shared/ui/app/dash";
import { FlowNavControls } from "@/shared/ui/app/flow-nav-controls";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { TzTime } from "@/shared/ui/app/tz-time";
import { useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { Button, Drawer, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

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
  const [error, setError] = useState("");
  const [values, setValues] = useState<AbstractFieldValues | null>(null);
  const [original, setOriginal] = useState<AbstractFieldValues | null>(null);
  const [rowVersion, setRowVersion] = useState<number | null>(null);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  /** Bumped to re-run the loader for the *same* submission — `router.refresh()`
   * re-renders the server tree but cannot reach this client-side fetch, so a
   * stale-write conflict needs its own reload signal. */
  const [reloadToken, setReloadToken] = useState(0);
  /** True from a 409 until the reload it triggers settles. Saving again in that
   * window would send the row version the server has already refused, so the
   * button stays disabled rather than buying a second guaranteed conflict. */
  const [reloading, setReloading] = useState(false);

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
    setDetail(null);
    setError("");
    setSaveError("");
    setValues(null);
    setOriginal(null);
    setRowVersion(null);
    setBusy(false);
    setReloading(false);
  }, [eventId, submissionId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/internal/submissions/${eventId}/${submissionId}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { data?: SubmissionDetailDTO; error?: { message?: string } } | null;
        if (cancelled) return;
        if (!response.ok || !payload?.data) {
          setError(payload?.error?.message ?? "Could not load this submission");
          return;
        }
        setDetail(payload.data);
        setValues(toValues(payload.data, vocabulary));
        setOriginal(toValues(payload.data, vocabulary));
        setRowVersion(payload.data.rowVersion);
      })
      .catch(() => { if (!cancelled) setError("Could not load this submission"); })
      .finally(() => { if (!cancelled) setReloading(false); });
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
  const interactionLocked = busy || reloading;
  useUnsavedWorkGuard(dirty);

  useEffect(() => {
    onBusyChange?.(interactionLocked);
  }, [interactionLocked, onBusyChange]);

  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  async function save() {
    if (!values || !original || rowVersion === null) return;
    const request = { eventId, submissionId };
    setBusy(true);
    setSaveError("");
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
        // pressing Save again: their copy is behind, so say so and reload it.
        // The reload has to be explicit — `router.refresh()` alone leaves this
        // drawer holding the same fields and the same row version, so every
        // retry would keep conflicting until it was closed and reopened.
        setSaveError("This abstract changed since you opened it. Reloading the latest version — please re-apply your edit.");
        setReloading(true);
        setReloadToken((token) => token + 1);
        router.refresh();
        return;
      }
      if (!response.ok || !payload?.data) {
        setSaveError(payload?.error?.message ?? "That did not save");
        return;
      }
      setRowVersion(payload.data.rowVersion);
      setOriginal(values);
      // The PATCH answers with the new row version and nothing else, but the
      // header reads `detail` — without this a saved title goes on showing the
      // old one for as long as the drawer stays open.
      setDetail((current) => current && { ...current, title: values.title });
      toast("Abstract saved");
      router.refresh();
    } finally {
      // Same rule as above, for the same reason: if the drawer has moved on,
      // `busy` now belongs to whatever is saving *there* and this request has no
      // business clearing it. The submission it does belong to was reset when
      // the drawer switched away.
      if (active.current.eventId === request.eventId && active.current.submissionId === request.submissionId) setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={detail ? formatCode(detail.code) : "Submission"}
      {...(nav ? { headerExtra: <FlowNavControls index={nav.index} total={nav.total} itemLabel={nav.itemLabel} onPrev={nav.onPrev} onNext={nav.onNext} /> } : {})}
    >
      {error && <p className="portal-note" role="alert">{error}</p>}
      {!detail && !error && <p className="portal-note">Loading…</p>}
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
                {saveError && <p className="portal-note" role="alert">{saveError}</p>}
                <AbstractFields
                  values={values}
                  onChange={setValues}
                  vocabulary={vocabulary}
                  timezone={timezone}
                  disabled={busy || reloading}
                />
                <div className="drawer-actions">
                  <Button disabled={busy || reloading || !dirty} onClick={save}>
                    {busy ? "Saving…" : reloading ? "Reloading…" : "Save changes"}
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
  );
}
