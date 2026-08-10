"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SubmissionVocabulary } from "@/features/submissions";
import { formatCode } from "@/features/submissions/index.client";
import { Button, Field, Modal } from "@/shared/ui/ui-kit";
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
 * manual row has to get its `SESS-n` from the same sequence a CFP submit does or
 * the two would eventually collide.
 */
const STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "accept_queue", label: "Accept queue" },
  { value: "decline_queue", label: "Decline queue" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
] as const;

export function AddAbstractDrawer({
  eventId,
  vocabulary,
  timezone,
  open,
  onClose,
}: {
  eventId: string;
  vocabulary: SubmissionVocabulary;
  timezone: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState<AbstractFieldValues>(EMPTY_ABSTRACT_FIELDS);
  const [status, setStatus] = useState<string>("pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/internal/submissions/${eventId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toCreateBody(values, status)),
      });
      const payload = await response.json().catch(() => null) as {
        data?: { submissionId: string; code: number };
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.data) {
        setError(payload?.error?.message ?? "That abstract could not be created");
        return;
      }
      toast(`${formatCode(payload.data.code)} created`);
      setValues(EMPTY_ABSTRACT_FIELDS);
      setStatus("pending");
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
      onClose={onClose}
      title="Add an abstract"
      description="Create a proposal on behalf of a speaker. It gets the next SESS number and sends nobody an email."
      wide
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || values.title.trim().length === 0} onClick={create}>
            {busy ? "Creating…" : "Create abstract"}
          </Button>
        </>
      }
    >
      {error && <p className="portal-note" role="alert">{error}</p>}
      <div className="form-stack">
        <Field label="Status">
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
      </div>
      <AbstractFields values={values} onChange={setValues} vocabulary={vocabulary} timezone={timezone} disabled={busy} />
    </Modal>
  );
}
