"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { SubmissionVocabulary } from "@/features/submissions";
import { formatCode } from "@/features/submissions/index.client";
import { SpeakerQuickAdd, type QuickAddedSpeaker } from "@/shared/ui/app/speaker-quick-add";
import { useGuardedAction, useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { Button, Field, Modal, Select } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import {
  AbstractFields,
  EMPTY_ABSTRACT_FIELDS,
  toCreateBody,
  type AbstractFieldValues,
} from "./abstract-fields";

/**
 * "Add abstract" — the invited keynote that never went through the CFP, typed in
 * by an organizer.
 *
 * It posts to `POST /api/internal/submissions/[eventId]`, whose handler calls
 * M18's `createSubmission`. No code is allocated here and no row is written
 * here: the repository has exactly one submission-insert site, and a
 * manual row gets its `SESS-n` from the same collision-resistant allocator as
 * a CFP submit.
 */
const STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "accept_queue", label: "Accept queue" },
  { value: "decline_queue", label: "Decline queue" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
] as const;

type ManualAbstractAttempt = Record<string, unknown> & { id: string };

export function manualAbstractDraftDirty(values: AbstractFieldValues, status: string, participantIds: string[]): boolean {
  return status !== "pending"
    || participantIds.length > 0
    || Object.entries(values).some(([key, value]) => key === "tagIds"
      ? (value as string[]).length > 0
      : value !== "" && value !== null);
}

export function manualAbstractCreateOutcomeUnknown(response: Response | null, hasData: boolean): boolean {
  return response === null || response.status >= 500 || (response.ok && !hasData);
}

export function AddAbstractDrawer({
  eventId,
  vocabulary,
  timezone,
  speakers,
  open,
  onClose,
}: {
  eventId: string;
  vocabulary: SubmissionVocabulary;
  timezone: string;
  /** Every contact on the event — the same list the agenda's session dialog offers. */
  speakers: QuickAddedSpeaker[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { runGuarded } = useGuardedAction();
  const [values, setValues] = useState<AbstractFieldValues>(EMPTY_ABSTRACT_FIELDS);
  const [status, setStatus] = useState<string>("pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const attemptRef = useRef<ManualAbstractAttempt | null>(null);
  /**
   * Who is giving the talk (#117). This drawer is the path built for the invited
   * keynote, and it could not name a speaker — so it produced an abstract
   * attributed to nobody, which is the one thing an invited talk always has.
   *
   * Selection order is the order they were picked, and the first one is the
   * primary. `createSubmission` requires exactly one primary when the list is
   * non-empty, which "first selected" satisfies by construction.
   */
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [addedSpeakers, setAddedSpeakers] = useState<QuickAddedSpeaker[]>([]);
  const pickable = [...speakers, ...addedSpeakers.filter((added) => !speakers.some((known) => known.contactId === added.contactId))];
  const dirty = manualAbstractDraftDirty(values, status, participantIds);
  useUnsavedWorkGuard(open && (dirty || busy), { blocking: busy });

  const toggleParticipant = (contactId: string) => setParticipantIds((current) => (
    current.includes(contactId) ? current.filter((id) => id !== contactId) : [...current, contactId]
  ));

  function discardAndClose() {
    setValues(EMPTY_ABSTRACT_FIELDS);
    setStatus("pending");
    setParticipantIds([]);
    setError("");
    setRecoveryRequired(false);
    attemptRef.current = null;
    setRequestId(crypto.randomUUID());
    onClose();
  }

  function requestClose() {
    runGuarded(discardAndClose);
  }

  async function create() {
    setBusy(true);
    setError("");
    try {
      const attempt = recoveryRequired && attemptRef.current
        ? attemptRef.current
        : {
            id: requestId,
            ...toCreateBody(values, status),
            participants: participantIds.map((contactId, index) => ({
              contactId,
              role: "speaker",
              isPrimary: index === 0,
            })),
          };
      attemptRef.current = attempt;
      const response = await fetch(`/api/internal/submissions/${eventId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(attempt),
      }).catch(() => null);
      const payload = await response?.json().catch(() => null) as {
        data?: { submissionId: string; code: number };
        error?: { message?: string };
      } | null;
      if (!response?.ok || !payload?.data) {
        const outcomeUnknown = manualAbstractCreateOutcomeUnknown(response, Boolean(payload?.data));
        setRecoveryRequired(outcomeUnknown);
        if (!outcomeUnknown) {
          attemptRef.current = null;
          setRequestId(crypto.randomUUID());
        }
        setError(outcomeUnknown
          ? "Creation could not be confirmed. Retry the unchanged submission to recover the result."
          : payload?.error?.message ?? "That submission could not be created");
        return;
      }
      toast(`${formatCode(payload.data.code)} created`);
      setValues(EMPTY_ABSTRACT_FIELDS);
      setStatus("pending");
      setParticipantIds([]);
      setRecoveryRequired(false);
      attemptRef.current = null;
      setRequestId(crypto.randomUUID());
      // `addedSpeakers` is deliberately kept: those contacts exist on the event
      // now, and the refresh below is what folds them into the server list. The
      // dedupe above drops the copy once it arrives.
      onClose();
      // The table is server-rendered from the same filters, so a refresh is what
      // keeps the rows, the tab counts and the pager agreeing with each other.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={requestClose}
      title="Add a submission"
      description="Create an abstract submission on behalf of a speaker. It gets the next SESS number and sends nobody an email."
      wide
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={requestClose}>Cancel</Button>
          <Button disabled={busy || values.title.trim().length === 0} onClick={create}>
            {busy ? recoveryRequired ? "Retrying…" : "Creating…" : recoveryRequired ? "Retry submission creation" : "Create submission"}
          </Button>
        </>
      }
    >
      {error && <p className="portal-note" role="alert">{error}</p>}
      <div className="form-stack">
        <Field label="Status">
          <Select value={status} disabled={busy || recoveryRequired} onChange={(event) => setStatus(event.target.value)}>
            {STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </Field>

        {/* #117 — this drawer is the path built for the invited keynote, and it
            had no participant fields at all, so it produced an abstract
            attributed to nobody. The speaker can also be created here, because
            on a fresh event there is nobody to pick yet. */}
        <Field
          label="Speakers"
          hint={participantIds.length > 1
            ? "The first one selected is the primary speaker."
            : "Who is giving this talk. Someone who never applied can be added here."}
        >
          <div className="agenda-speaker-picker">
            {pickable.length === 0 && (
              <span className="dash">No contacts on this event yet — add the speaker below</span>
            )}
            {pickable.map((speaker) => {
              const position = participantIds.indexOf(speaker.contactId);
              return (
                <label key={speaker.contactId}>
                  <input
                    type="checkbox"
                    checked={position !== -1}
                    disabled={busy || recoveryRequired}
                    onChange={() => toggleParticipant(speaker.contactId)}
                  />
                  {speaker.name}{position === 0 && participantIds.length > 1 ? " · primary" : ""}
                </label>
              );
            })}
          </div>
          <div className="speaker-picker-add">
            <SpeakerQuickAdd
              eventId={eventId}
              disabled={busy || recoveryRequired}
              onAdded={(speaker) => {
                setAddedSpeakers((current) => [...current, speaker]);
                toggleParticipant(speaker.contactId);
              }}
            />
          </div>
        </Field>
      </div>
      <AbstractFields values={values} onChange={setValues} vocabulary={vocabulary} timezone={timezone} disabled={busy || recoveryRequired} />
    </Modal>
  );
}
