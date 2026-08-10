"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SpeakerDetailDTO } from "@/features/portal";
import { Button, Field, Modal } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

/**
 * M51 — manual "Add speaker" (work order step 2). Posts through
 * `createSpeaker` → the two contacts helpers (resolution #13); on success the
 * organizer lands straight on the new speaker's detail page, where every
 * other field (bio, headshot, logistics values, unavailability) is edited.
 */
export function SpeakerCreateDialog({ eventId, open, onClose }: { eventId: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEmail(""); setFirstName(""); setLastName(""); setJobTitle(""); setCompany(""); setError(null);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/internal/speakers/${eventId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, firstName, lastName, jobTitle, company }),
      });
      const json = await response.json() as { data?: SpeakerDetailDTO; error?: { message?: string } };
      if (!response.ok || !json.data) throw new Error(json.error?.message ?? "Could not add that speaker");
      toast(`${json.data.contact.name || email} added`);
      reset();
      onClose();
      router.push(`/events/${eventId}/speakers/${json.data.contact.contactId}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not add that speaker");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Add speaker"
      description="Create a speaker manually — for organizer-sourced talks, panelists, or co-hosts who never went through the CFP."
      footer={<>
        <Button variant="secondary" onClick={() => { reset(); onClose(); }}>Cancel</Button>
        <Button disabled={saving || !email.trim()} onClick={() => void submit()}>{saving ? "Adding…" : "Add speaker"}</Button>
      </>}
    >
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <Field label="Email" required error={error ?? undefined}>
          <input type="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} placeholder="speaker@example.com" />
        </Field>
        <div className="form-grid">
          <Field label="First name"><input value={firstName} onChange={(event) => setFirstName(event.target.value)} /></Field>
          <Field label="Last name"><input value={lastName} onChange={(event) => setLastName(event.target.value)} /></Field>
        </div>
        <div className="form-grid">
          <Field label="Title"><input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} /></Field>
          <Field label="Company"><input value={company} onChange={(event) => setCompany(event.target.value)} /></Field>
        </div>
      </form>
    </Modal>
  );
}
