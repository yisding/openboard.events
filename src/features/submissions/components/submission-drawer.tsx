"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { SubmissionDetailDTO } from "@/shared/contracts";
import type { SubmissionVocabulary } from "@/features/submissions";
import { formatCode } from "@/features/submissions/index.client";
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
}: {
  eventId: string;
  submissionId: string;
  timezone: string;
  vocabulary: SubmissionVocabulary;
  canEdit?: boolean;
  onClose: () => void;
  /** M57 — keyboard/click next-prev across the table's current rows. */
  nav?: { index: number; total: number; onPrev?: (() => void) | undefined; onNext?: (() => void) | undefined };
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

  // Blanking belongs to *opening a different submission*, not to reloading the
  // one on screen: a reload after a 409 has to keep the message explaining why
  // it is reloading, which the loader below would otherwise clear out from under
  // the organizer.
  useEffect(() => {
    setDetail(null);
    setError("");
    setSaveError("");
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
      .catch(() => { if (!cancelled) setError("Could not load this submission"); });
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

  async function save() {
    if (!values || !original || rowVersion === null) return;
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
      if (response.status === 409 || payload?.error?.code === "STALE_WRITE") {
        // Not an error the organizer caused, and not one they can fix by
        // pressing Save again: their copy is behind, so say so and reload it.
        // The reload has to be explicit — `router.refresh()` alone leaves this
        // drawer holding the same fields and the same row version, so every
        // retry would keep conflicting until it was closed and reopened.
        setSaveError("This abstract changed since you opened it. Reloading the latest version — please re-apply your edit.");
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
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={detail ? formatCode(detail.code) : "Submission"}
      {...(nav ? { headerExtra: <FlowNavControls index={nav.index} total={nav.total} onPrev={nav.onPrev} onNext={nav.onNext} /> } : {})}
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
                  disabled={busy}
                />
                <div className="drawer-actions">
                  <Button disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save changes"}</Button>
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
          </div>
        </div>
      )}
    </Drawer>
  );
}
