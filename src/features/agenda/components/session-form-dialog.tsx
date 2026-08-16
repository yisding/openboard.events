"use client";

import { AlertTriangle, ArrowRight, History, MapPin } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EventId, ScheduledSessionDTO, SessionContentRevisionDTO, SessionId, SessionPlacementRevisionDTO } from "@/shared/contracts";
import { sessionHistoryDtoSchema, sessionIdSchema } from "@/shared/contracts";
import { isAppError, isDefinitiveWriteFailure } from "@/shared/lib/errors";
import { api } from "@/shared/lib/api-client";
import { formatInZone, zoneAbbreviation } from "@/shared/lib/time";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { emitTourSignal } from "@/shared/ui/app/guided-tour/signals";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { SpeakerQuickAdd, type QuickAddedSpeaker } from "@/shared/ui/app/speaker-quick-add";
import { TzTime } from "@/shared/ui/app/tz-time";
import { useGuardedAction, useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { useToast } from "@/shared/ui/toast";
import { Button, Field, Modal, Select } from "@/shared/ui/ui-kit";
import type { AgendaViewProps } from "../index.client";
import { agendaKeys } from "../hooks/keys";
import { useSessionMutations, type SaveSessionPayload } from "../hooks/use-session-mutations";
import { roomCapacityWarning } from "../lib/room-capacity";
import { defaultScheduledRange } from "../store";

const revisionsSchema = sessionHistoryDtoSchema;

export type SessionDraft = {
  title: string;
  descriptionHtml: string;
  formatId: string;
  trackId: string;
  roomId: string;
  startsAt: string | null;
  endsAt: string | null;
  speakerContactIds: string[];
  status: "draft" | "published";
};

/**
 * Change the format, and re-prefill the end time with the new format's default
 * duration — but only while the draft is still carrying a prefilled one.
 *
 * The default duration used to land at exactly one moment: unticking "Leave
 * unscheduled". Choosing "Workshop" (90 min) after that left a placed session
 * running the no-format 30 minutes, with nothing on screen saying the format's
 * own default had been ignored. Comparing the current duration against what the
 * *previous* format prefilled is what keeps a duration the organizer typed by
 * hand from being overwritten.
 */
export function draftWithFormat(
  draft: SessionDraft,
  formatId: string,
  previousDefaultMs: number,
  nextDefaultMs: number,
): SessionDraft {
  const next = { ...draft, formatId };
  if (draft.startsAt === null || draft.endsAt === null) return next;
  if (Date.parse(draft.endsAt) - Date.parse(draft.startsAt) !== previousDefaultMs) return next;
  return { ...next, endsAt: new Date(Date.parse(draft.startsAt) + nextDefaultMs).toISOString() };
}

export function isSessionDraftDirty(draft: SessionDraft, original: SessionDraft): boolean {
  return JSON.stringify(draft) !== JSON.stringify(original);
}

const EMPTY: SessionDraft = {
  title: "", descriptionHtml: "", formatId: "", trackId: "", roomId: "",
  startsAt: null, endsAt: null, speakerContactIds: [], status: "draft",
};

function toDraft(session: ScheduledSessionDTO): SessionDraft {
  return {
    title: session.title,
    descriptionHtml: session.descriptionHtml,
    formatId: session.formatId ?? "",
    trackId: session.trackId ?? "",
    roomId: session.roomId ?? "",
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    speakerContactIds: [...session.speakerIds],
    status: session.status,
  };
}

const STALE_MESSAGE = "Session changed since you loaded it — refresh";
const CREATE_RECOVERY_MESSAGE = "We could not confirm whether this session was created. Its details are locked so Retry creation can safely recover the same attempt. You can also close and check the agenda.";

function messageFor(caught: unknown, fallback: string): string {
  if (!isAppError(caught)) return fallback;
  return caught.code === "STALE_WRITE" ? STALE_MESSAGE : caught.message;
}

/**
 * Create, edit and delete, in one dialog.
 *
 * Three behaviors are load-bearing and easy to get wrong:
 *
 * - **Unscheduled is a state, not an empty field.** The toggle nulls *both*
 *   times together, because the database's CHECK is `(starts_at IS NULL) =
 *   (ends_at IS NULL)` and a half-cleared pair is a 400 the organizer cannot
 *   read.
 * - **A 409 does not close the dialog.** Somebody else changed the row; closing
 *   would throw away what this organizer typed on the way to telling them so.
 * - **Delete is the same version-CAS write as save**, behind a `ConfirmDialog`,
 *   and only on an existing session — this dialog is the agenda's one edit
 *   surface, so a delete that lives anywhere else would not exist at all.
 */
export function SessionFormDialog({
  open,
  onClose,
  session,
  defaultDay,
  eventId,
  event,
  rooms,
  tracks,
  formats,
  speakers,
}: {
  open: boolean;
  onClose: () => void;
  /** Absent for create. */
  session: ScheduledSessionDTO | null;
  /** Event-local day selected in the agenda toolbar. */
  defaultDay: string | null;
} & Pick<AgendaViewProps, "eventId" | "event" | "rooms" | "tracks" | "formats" | "speakers">) {
  const { toast } = useToast();
  const { runGuarded } = useGuardedAction();
  const { save, remove, restoreContent } = useSessionMutations(eventId);
  const [draft, setDraft] = useState<SessionDraft>(() => session ? toDraft(session) : EMPTY);
  const [original, setOriginal] = useState<SessionDraft>(() => session ? toDraft(session) : EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [creationId, setCreationId] = useState<SessionId | null>(null);
  const [createRecovery, setCreateRecovery] = useState<{ payload: SaveSessionPayload & { creationId: SessionId } } | null>(null);
  const [speakerQuickAddPending, setSpeakerQuickAddPending] = useState(false);

  const closeAfterMutation = () => {
    if (!session) {
      setDraft(EMPTY);
      setOriginal(EMPTY);
      setCreateRecovery(null);
      setCreationId(null);
    }
    onClose();
  };

  // Re-seeding on identity, not on every render: the dialog is shared by the
  // toolbar and all six views, so a stale draft would follow the organizer from
  // one row to the next.
  const identity = session ? `${session.id}:${session.rowVersion}` : "new";
  useEffect(() => {
    if (!open) return;
    const next = session ? toDraft(session) : EMPTY;
    setDraft(next);
    setOriginal(next);
    setError(null);
    setConfirmingDelete(false);
    setCreateRecovery(null);
    setSpeakerQuickAddPending(false);
    setCreationId(session ? null : sessionIdSchema.parse(crypto.randomUUID()));
  }, [identity, open, session]);

  const formatDurationMs = useCallback((formatId: string) => {
    const format = formats.find((candidate) => String(candidate.id) === formatId);
    return (format?.defaultDurationMins ?? 30) * 60_000;
  }, [formats]);
  const defaultDurationMs = useMemo(() => formatDurationMs(draft.formatId), [formatDurationMs, draft.formatId]);

  const scheduled = draft.startsAt !== null;

  // Live against the *draft's* room, so picking a smaller room says so before
  // the save rather than after it. `session` is the only source of an expected
  // audience — a session being created here has no abstract behind it yet, so
  // there is nothing truthful to compare and nothing is shown.
  const capacityWarning = useMemo(
    () => roomCapacityWarning({ expectedAttendance: session?.expectedAttendance ?? null, roomId: draft.roomId }, rooms),
    [draft.roomId, rooms, session],
  );

  const setStart = (next: string | null) => {
    setDraft((current) => {
      if (next === null) return { ...current, startsAt: null, endsAt: null };
      const duration = current.startsAt && current.endsAt
        ? Date.parse(current.endsAt) - Date.parse(current.startsAt)
        : defaultDurationMs;
      return { ...current, startsAt: next, endsAt: new Date(Date.parse(next) + duration).toISOString() };
    });
  };

  const toggleSpeaker = (contactId: string) => {
    setDraft((current) => ({
      ...current,
      speakerContactIds: current.speakerContactIds.includes(contactId)
        ? current.speakerContactIds.filter((id) => id !== contactId)
        : [...current.speakerContactIds, contactId],
    }));
  };

  /**
   * Speakers created from inside this dialog. `speakers` comes from the page's
   * server render and will not include them until the next navigation, so the
   * person the organizer just typed in has to be held here to stay visible and
   * checked.
   *
   * Deliberately *not* cleared when `identity` changes. A created contact
   * belongs to the event, not to the session that happened to be open when it
   * was made — clearing on switch would drop the only client-side copy of a
   * contact that really exists on the server, and it would vanish from every
   * later picker until a manual refresh.
   */
  const [addedSpeakers, setAddedSpeakers] = useState<QuickAddedSpeaker[]>([]);
  const pickableSpeakers = useMemo<QuickAddedSpeaker[]>(() => {
    const known = speakers.map((speaker) => ({ contactId: String(speaker.contactId), name: speaker.name }));
    const knownIds = new Set(known.map((speaker) => speaker.contactId));
    return [...known, ...addedSpeakers.filter((added) => !knownIds.has(added.contactId))];
  }, [speakers, addedSpeakers]);

  const submit = async () => {
    setError(null);
    const payload: SaveSessionPayload = session
      ? {
          id: session.id as SessionId,
          expectedVersion: session.rowVersion,
          title: draft.title.trim(),
          descriptionHtml: draft.descriptionHtml,
          formatId: draft.formatId || null,
          trackId: draft.trackId || null,
          roomId: draft.roomId || null,
          startsAt: draft.startsAt,
          endsAt: draft.endsAt,
          speakerContactIds: draft.speakerContactIds,
          status: draft.status,
        }
      : createRecovery?.payload ?? {
          creationId: creationId as SessionId,
          title: draft.title.trim(),
          descriptionHtml: draft.descriptionHtml,
          formatId: draft.formatId || null,
          trackId: draft.trackId || null,
          roomId: draft.roomId || null,
          startsAt: draft.startsAt,
          endsAt: draft.endsAt,
          speakerContactIds: [...draft.speakerContactIds],
          status: draft.status,
        };
    try {
      await save.mutateAsync(payload);
      // A latency shortcut for the guided tour: placing a session is the
      // objective the tutorial's set-piece waits on, and this saves it a poll
      // interval. It is never the authority — the objective is still decided by
      // the server's world snapshot, so removing this line costs two seconds.
      emitTourSignal("agenda.session-saved");
      toast(session ? "Session updated" : "Session created");
      closeAfterMutation();
    } catch (caught) {
      const ambiguousCreate = !session && !isDefinitiveWriteFailure(caught);
      if (ambiguousCreate && "creationId" in payload && payload.creationId !== undefined) {
        setCreateRecovery((current) => current ?? { payload: payload as SaveSessionPayload & { creationId: SessionId } });
      }
      const message = ambiguousCreate
        ? CREATE_RECOVERY_MESSAGE
        : messageFor(caught, "Could not save the session");
      setError(message);
      toast(message, { kind: "error" });
    }
  };

  // Same `expectedVersion` guard the save path uses: a delete racing somebody
  // else's edit is a 409 shown in place, not a row quietly removed underneath
  // them. The confirm closes either way — the answer to "are you sure" has been
  // given, and the message belongs on the form.
  const confirmDelete = async () => {
    if (!session) return;
    setError(null);
    try {
      await remove.mutateAsync({ id: session.id as SessionId, expectedVersion: session.rowVersion });
      setConfirmingDelete(false);
      toast("Session deleted");
      closeAfterMutation();
    } catch (caught) {
      const message = messageFor(caught, "Could not delete the session");
      setConfirmingDelete(false);
      setError(message);
      toast(message, { kind: "error" });
    }
  };

  // Quick-add owns a separate request, but its result becomes part of this
  // session. Do not let Save freeze a payload or let the dialog disappear
  // until that contact exists and has been selected by `onAdded`.
  const busy = save.isPending || remove.isPending || speakerQuickAddPending;
  const createLocked = !session && createRecovery !== null;
  // Freeze the visible draft as soon as its create request leaves the browser.
  // If that response is lost, the recovery payload and the details still on
  // screen must be the same attempt — not an old request hidden behind newer
  // editable values.
  const createControlsLocked = !session && (save.isPending || createLocked);
  const dirty = isSessionDraftDirty(draft, original);
  useUnsavedWorkGuard(open && (dirty || busy), { blocking: busy });

  const requestClose = () => {
    if (busy) return;
    // The recovery button already says exactly what this choice does. Asking a
    // second generic "discard changes?" question would make the explicit safe
    // escape feel like a trap; the agenda was refreshed when the outcome first
    // became ambiguous, so closing now really does let the organizer check it.
    if (createLocked) {
      setDraft(original);
      setError(null);
      setConfirmingDelete(false);
      setCreateRecovery(null);
      setCreationId(null);
      onClose();
      return;
    }
    runGuarded(() => {
      setDraft(original);
      setError(null);
      setConfirmingDelete(false);
      setCreateRecovery(null);
      setCreationId(null);
      onClose();
    });
  };

  return (
    <>
      <Modal
        open={open}
        onClose={requestClose}
        title={session ? "Edit session" : "Create a session"}
        description={session ? "Update the details, speakers and placement." : "Add it now and schedule it whenever you are ready."}
        wide
        footer={(
          <>
            {session && (
              // Pushed to the far edge of a `justify-content: flex-end` footer, so
              // the destructive action is nowhere near the button the organizer is
              // aiming for.
              <Button
                variant="danger"
                style={{ marginInlineEnd: "auto" }}
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
              >
                {remove.isPending ? "Deleting…" : "Delete"}
              </Button>
            )}
            <Button variant="secondary" onClick={requestClose} disabled={busy}>{createLocked ? "Close and check agenda" : "Cancel"}</Button>
            <Button disabled={draft.title.trim().length === 0 || busy || (!session && creationId === null)} onClick={() => { void submit(); }}>
              {save.isPending ? createLocked ? "Retrying…" : "Saving…" : createLocked ? "Retry creation" : "Save session"}
            </Button>
          </>
        )}
      >
        <div className="form-stack">
          {error && <p className="conflict-check warning" role="alert"><span>{error}</span></p>}

          <fieldset
            className="form-stack"
            disabled={createControlsLocked}
            style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}
          >

          <Field label="Session title" required>
            <input
              autoFocus
              value={draft.title}
              maxLength={255}
              onChange={(changed) => setDraft((current) => ({ ...current, title: changed.target.value }))}
              placeholder="Enter a session title"
            />
          </Field>

          <Field label="Description">
            <RichTextEditor
              value={draft.descriptionHtml}
              onChange={(html) => setDraft((current) => ({ ...current, descriptionHtml: html }))}
              ariaLabel="Session description"
              placeholder="What is this session about?"
              disabled={createControlsLocked}
            />
          </Field>

          <div className="form-grid">
            <Field label="Format">
              <Select
                value={draft.formatId}
                onChange={(changed) => setDraft((current) => draftWithFormat(
                  current,
                  changed.target.value,
                  formatDurationMs(current.formatId),
                  formatDurationMs(changed.target.value),
                ))}
              >
                <option value="">No format</option>
                {formats.map((format) => <option key={String(format.id)} value={String(format.id)}>{format.name}</option>)}
              </Select>
            </Field>
            <Field label="Track">
              <Select value={draft.trackId} onChange={(changed) => setDraft((current) => ({ ...current, trackId: changed.target.value }))}>
                <option value="">No track</option>
                {tracks.map((track) => <option key={String(track.id)} value={String(track.id)}>{track.name}</option>)}
              </Select>
            </Field>
            <Field label="Room">
              <Select value={draft.roomId} onChange={(changed) => setDraft((current) => ({ ...current, roomId: changed.target.value }))}>
                <option value="">No room</option>
                {rooms.map((room) => <option key={String(room.id)} value={String(room.id)}>{room.name}</option>)}
              </Select>
              {/* MTP-07 step 12 — advisory, never a gate: the Save button stays
                  enabled, because an organizer who deliberately puts a big draw
                  in a small room is making a programming decision, not a
                  mistake. `role="status"` for the same reason — a warning the
                  save path does not act on must not interrupt like an alert. */}
              {capacityWarning && (
                <p className="agenda-capacity-note" role="status">
                  <AlertTriangle size={14} aria-hidden />
                  <span>{capacityWarning} You can still place it here.</span>
                </p>
              )}
            </Field>
          </div>

          {/* `group`, not a plain label: the control here is a checkbox with its
              own <label>, and nesting one label inside another is invalid HTML —
              clicking the word "Placement" toggled the checkbox and the
              accessible name ran the group label, the option and the hint
              together. */}
          <Field label="Placement" group hint={`Times are in ${zoneAbbreviation(draft.startsAt ?? event.startsAt, event.timezone)}.`}>
            <label className="agenda-unscheduled-toggle">
              <input
                type="checkbox"
                checked={!scheduled}
                onChange={(changed) => {
                  if (changed.target.checked) {
                    setStart(null);
                    return;
                  }
                  const range = defaultScheduledRange(event, defaultDay, defaultDurationMs);
                  setDraft((current) => ({ ...current, ...range }));
                }}
              />
              Leave unscheduled (keep in the tray)
            </label>
          </Field>

          {scheduled && (
            <div className="form-grid">
              <Field label="Starts">
                <DateTimePicker value={draft.startsAt} onChange={setStart} tz={event.timezone} clearable={false} />
              </Field>
              <Field label="Ends">
                <DateTimePicker
                  value={draft.endsAt}
                  onChange={(next) => setDraft((current) => ({ ...current, endsAt: next }))}
                  tz={event.timezone}
                  clearable={false}
                />
              </Field>
            </div>
          )}

          {/* #117 — the invited keynote. This picker used to dead-end on a fresh
              event: "no contacts yet" with nothing to do about it, so the only
              way on was to abandon a half-filled dialog, create the contact on
              Speakers, and start over. The speaker is now created here. */}
          {/* `group` for the same reason as Placement above: the control is a
              list of checkboxes that each own a <label>, and a <label> wrapping
              them is invalid HTML — it labelled only the first checkbox, with
              an accessible name built from every *other* speaker's name. */}
          <Field label="Speakers" group hint="The first one selected is the primary speaker.">
            <div className="agenda-speaker-picker">
              {pickableSpeakers.length === 0 && (
                <span className="dash">No contacts on this event yet — add the speaker below</span>
              )}
              {pickableSpeakers.map((speaker) => (
                <label key={speaker.contactId}>
                  <input
                    type="checkbox"
                    checked={draft.speakerContactIds.includes(speaker.contactId)}
                    onChange={() => toggleSpeaker(speaker.contactId)}
                  />
                  {speaker.name}
                </label>
              ))}
            </div>
            <div className="speaker-picker-add">
              <SpeakerQuickAdd
                key={identity}
                eventId={String(eventId)}
                disabled={createControlsLocked}
                onPendingChange={setSpeakerQuickAddPending}
                onAdded={(speaker) => {
                  setAddedSpeakers((current) => [...current, speaker]);
                  toggleSpeaker(speaker.contactId);
                }}
              />
            </div>
          </Field>

          <Field label="Status">
            <Select
              value={draft.status}
              onChange={(changed) => setDraft((current) => ({ ...current, status: changed.target.value === "published" ? "published" : "draft" }))}
            >
              <option value="draft">Draft — not on the public schedule</option>
              <option value="published">Published — visible and speakers notified</option>
            </Select>
          </Field>

          {/* M52: attributed content history + restore. Restoring content
              never changes `status` — publish/unpublish stays this Status
              field's job, so a restore can never leak a draft. */}
          {session && (
            <SessionHistoryPanel
              eventId={eventId}
              sessionId={session.id}
              timezone={event.timezone}
              onRestore={async (revisionId) => {
                try {
                  const restored = await restoreContent.mutateAsync({
                    id: session.id,
                    revisionId,
                    // The version this dialog was opened against, exactly as
                    // Save and Delete send it: a restore that would overwrite
                    // somebody else's edit must be refused, not silently win.
                    expectedVersion: session.rowVersion,
                  });
                  setDraft((current) => ({ ...current, title: restored.title, descriptionHtml: restored.descriptionHtml }));
                  toast("Restored as the current content");
                } catch (caught) {
                  toast(messageFor(caught, "Could not restore that revision"), { kind: "error" });
                }
              }}
            />
          )}
          </fieldset>
        </div>
      </Modal>

      <ConfirmDialog
        open={open && session !== null && confirmingDelete}
        title="Delete this session?"
        body={session
          ? `“${session.title}” is removed from the agenda and from the public schedule. Its speakers keep their other sessions. This cannot be undone.`
          : ""}
        confirmLabel="Delete session"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}

/**
 * One side of a recorded move, as a sentence.
 *
 * Exported for its test, and pure: the room name is whatever was frozen into
 * the record, so a room deleted since the move still reads as the room the
 * session was actually in.
 */
export function describePlacement(
  side: SessionPlacementRevisionDTO["from"],
  timezone: string,
): string {
  if (side.startsAt === null) return side.roomName ? `${side.roomName}, unscheduled` : "Unscheduled";
  const when = `${formatInZone(side.startsAt, timezone, "dateTime")}`;
  return side.roomName ? `${side.roomName}, ${when}` : `No room, ${when}`;
}

/**
 * M52 — a session's attributed title/description history, newest first, with
 * a Restore action per earlier entry. The list refetches after a restore
 * (through `agendaKeys.revisions`, invalidated the same way every other
 * agenda write invalidates `allSessions`) so the new "restored from" entry
 * appears without the organizer having to reopen the dialog.
 *
 * MTP-07 step 14 adds the other half of that history below it: where this
 * session used to sit, where it went, and who moved it. Both halves arrive in
 * one request, because a panel with two spinners can be half-broken and this
 * one cannot.
 */
function SessionHistoryPanel({
  eventId,
  sessionId,
  timezone,
  onRestore,
}: {
  eventId: EventId;
  sessionId: SessionId;
  timezone: string;
  onRestore: (revisionId: string) => Promise<void>;
}) {
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: agendaKeys.revisions(eventId, sessionId),
    queryFn: () => api(`agenda/sessions/${sessionId}/revisions?eventId=${eventId}`, revisionsSchema),
  });
  const revisions = query.data?.content ?? [];
  const placements = query.data?.placements ?? [];
  const hint = revisions.length > 0 ? `${revisions.length} revision${revisions.length === 1 ? "" : "s"}` : undefined;
  const placementHint = placements.length > 0 ? `${placements.length} move${placements.length === 1 ? "" : "s"}` : undefined;

  return (
    <>
    <Field label="Content history" group {...(hint ? { hint } : {})}>
      {query.isLoading && <p className="portal-note">Loading history…</p>}
      {query.isError && (
        <p className="portal-note" role="alert">
          Could not load content history. <Button size="sm" variant="secondary" disabled={query.isFetching} onClick={() => { void query.refetch(); }}>
            {query.isFetching ? "Retrying…" : "Retry"}
          </Button>
        </p>
      )}
      {!query.isLoading && !query.isError && revisions.length === 0 && <p className="portal-note">No edits recorded yet.</p>}
      {revisions.length > 0 && (
        <ul className="portal-uploads">
          {revisions.map((revision: SessionContentRevisionDTO, index: number) => (
            <li key={revision.id}>
              <History size={14} />
              <span>
                <b>{revision.title}</b>{" "}
                <small style={{ color: "var(--muted)" }}>
                  {revision.editedByName ?? "Someone"} · <TzTime instant={revision.createdAt} tz={timezone} style="date" />
                  {revision.restoredFromRevisionId && " · restored"}
                </small>
              </span>
              {index === 0
                ? <em>Current</em>
                : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={restoringId !== null}
                    onClick={async () => {
                      setRestoringId(revision.id);
                      try {
                        await onRestore(revision.id);
                        await query.refetch();
                      } finally {
                        setRestoringId(null);
                      }
                    }}
                  >
                    {restoringId === revision.id ? "Restoring…" : "Restore"}
                  </Button>
                )}
            </li>
          ))}
        </ul>
      )}
      {revisions[0]?.descriptionHtml && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", fontSize: "var(--text-xs)", color: "var(--muted)" }}>Preview current description</summary>
          <RichTextView html={revisions[0].descriptionHtml} />
        </details>
      )}
    </Field>

    {/* MTP-07 step 14: "prior placements are recorded with who and when."
        Every writer records into the same table — the grid drag, this dialog's
        own save, Auto-place's apply and an Undo — so this list is the whole
        story of where the session has been, not just the moves made from here. */}
    <Field label="Placement history" group {...(placementHint ? { hint: placementHint } : {})}>
      {!query.isLoading && !query.isError && placements.length === 0 && (
        <p className="portal-note">No moves recorded yet — the room and time this session has now are its first.</p>
      )}
      {placements.length > 0 && (
        <ul className="agenda-placement-history">
          {placements.map((move: SessionPlacementRevisionDTO) => (
            <li key={move.id}>
              <MapPin size={14} aria-hidden />
              <span>
                <b>{describePlacement(move.from, timezone)}</b>
                {" "}<ArrowRight size={11} aria-hidden />{" "}
                <b>{describePlacement(move.to, timezone)}</b>
                <small>
                  {move.movedByName ?? "Someone"} · <TzTime instant={move.createdAt} tz={timezone} style="date" />
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Field>
    </>
  );
}
