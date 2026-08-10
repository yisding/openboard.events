"use client";

import { useEffect, useMemo, useState } from "react";
import type { ScheduledSessionDTO, SessionId } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { useToast } from "@/shared/ui/toast";
import { Button, Field, Modal } from "@/shared/ui/ui-kit";
import type { AgendaViewProps } from "../index.client";
import { useSessionMutations } from "../hooks/use-session-mutations";

type Draft = {
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

const EMPTY: Draft = {
  title: "", descriptionHtml: "", formatId: "", trackId: "", roomId: "",
  startsAt: null, endsAt: null, speakerContactIds: [], status: "draft",
};

function toDraft(session: ScheduledSessionDTO): Draft {
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
} & Pick<AgendaViewProps, "eventId" | "event" | "rooms" | "tracks" | "formats" | "speakers">) {
  const { toast } = useToast();
  const { save, remove } = useSessionMutations(eventId);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Re-seeding on identity, not on every render: the dialog is shared by the
  // toolbar and all six views, so a stale draft would follow the organizer from
  // one row to the next.
  const identity = session ? `${session.id}:${session.rowVersion}` : "new";
  useEffect(() => {
    setDraft(session ? toDraft(session) : EMPTY);
    setError(null);
    setConfirmingDelete(false);
  }, [identity, session]);

  const defaultDurationMs = useMemo(() => {
    const format = formats.find((candidate) => String(candidate.id) === draft.formatId);
    return (format?.defaultDurationMins ?? 30) * 60_000;
  }, [formats, draft.formatId]);

  const scheduled = draft.startsAt !== null;

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

  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync({
        ...(session ? { id: session.id as SessionId, expectedVersion: session.rowVersion } : {}),
        title: draft.title.trim(),
        descriptionHtml: draft.descriptionHtml,
        formatId: draft.formatId || null,
        trackId: draft.trackId || null,
        roomId: draft.roomId || null,
        startsAt: draft.startsAt,
        endsAt: draft.endsAt,
        speakerContactIds: draft.speakerContactIds,
        status: draft.status,
      });
      toast(session ? "Session updated" : "Session created");
      onClose();
    } catch (caught) {
      const message = messageFor(caught, "Could not save the session");
      setError(message);
      toast(message);
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
      onClose();
    } catch (caught) {
      const message = messageFor(caught, "Could not delete the session");
      setConfirmingDelete(false);
      setError(message);
      toast(message);
    }
  };

  const busy = save.isPending || remove.isPending;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
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
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button disabled={draft.title.trim().length === 0 || busy} onClick={() => { void submit(); }}>
              {save.isPending ? "Saving…" : "Save session"}
            </Button>
          </>
        )}
      >
        <div className="form-stack">
          {error && <p className="conflict-check warning" role="alert"><span>{error}</span></p>}

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
            />
          </Field>

          <div className="form-grid">
            <Field label="Format">
              <select value={draft.formatId} onChange={(changed) => setDraft((current) => ({ ...current, formatId: changed.target.value }))}>
                <option value="">No format</option>
                {formats.map((format) => <option key={String(format.id)} value={String(format.id)}>{format.name}</option>)}
              </select>
            </Field>
            <Field label="Track">
              <select value={draft.trackId} onChange={(changed) => setDraft((current) => ({ ...current, trackId: changed.target.value }))}>
                <option value="">No track</option>
                {tracks.map((track) => <option key={String(track.id)} value={String(track.id)}>{track.name}</option>)}
              </select>
            </Field>
            <Field label="Room">
              <select value={draft.roomId} onChange={(changed) => setDraft((current) => ({ ...current, roomId: changed.target.value }))}>
                <option value="">No room</option>
                {rooms.map((room) => <option key={String(room.id)} value={String(room.id)}>{room.name}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Placement" hint={`Times are in ${event.timezone}.`}>
            <label className="agenda-unscheduled-toggle">
              <input
                type="checkbox"
                checked={!scheduled}
                onChange={(changed) => setStart(changed.target.checked ? null : new Date().toISOString())}
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

          <Field label="Speakers" hint="The first one selected is the primary speaker.">
            <div className="agenda-speaker-picker">
              {speakers.length === 0 && <span className="dash">No contacts on this event yet</span>}
              {speakers.map((speaker) => (
                <label key={String(speaker.contactId)}>
                  <input
                    type="checkbox"
                    checked={draft.speakerContactIds.includes(String(speaker.contactId))}
                    onChange={() => toggleSpeaker(String(speaker.contactId))}
                  />
                  {speaker.name}
                </label>
              ))}
            </div>
          </Field>

          <Field label="Status">
            <select
              value={draft.status}
              onChange={(changed) => setDraft((current) => ({ ...current, status: changed.target.value === "published" ? "published" : "draft" }))}
            >
              <option value="draft">Draft — not on the public schedule</option>
              <option value="published">Published — visible and speakers notified</option>
            </select>
          </Field>
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
