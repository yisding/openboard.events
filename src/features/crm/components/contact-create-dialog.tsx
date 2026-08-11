"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { organizationContactIdSchema, type OrganizationId } from "@/shared/contracts";
import { Button, Field, Modal } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";

const createdSchema = z.object({ id: organizationContactIdSchema });

/** M55 — manual add, the third way a directory row can appear alongside CSV
 * import and CRM push-from-event. */
export function ContactCreateDialog({ organizationId, open, onClose }: { organizationId: OrganizationId; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function reset() {
    setEmail(""); setFirstName(""); setLastName(""); setCompany(""); setJobTitle("");
    setError(null); setFieldErrors({});
  }

  async function create() {
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const created = await api(`organizations/${organizationId}/crm/contacts`, createdSchema, {
        method: "POST",
        body: { email, firstName: firstName || undefined, lastName: lastName || undefined, company: company || undefined, jobTitle: jobTitle || undefined },
      });
      toast(`${email} added to the directory`);
      reset();
      onClose();
      router.push(`/organizations/${organizationId}/crm/${created.id}`);
    } catch (caught) {
      if (isAppError(caught)) {
        setError(caught.message);
        if (caught.fieldErrors) setFieldErrors(caught.fieldErrors);
      } else {
        setError("That contact could not be created");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Add a contact"
      description="A new organization-wide identity, not tied to any one event yet."
      footer={<>
        <Button variant="secondary" onClick={() => { reset(); onClose(); }} disabled={busy}>Cancel</Button>
        <Button onClick={() => void create()} disabled={busy || !email.trim()}>{busy ? "Adding…" : "Add contact"}</Button>
      </>}
    >
      <div className="form-stack">
        <Field label="Email" required error={fieldErrors.email}>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" autoFocus />
        </Field>
        <div className="form-grid">
          <Field label="First name"><input value={firstName} onChange={(event) => setFirstName(event.target.value)} /></Field>
          <Field label="Last name"><input value={lastName} onChange={(event) => setLastName(event.target.value)} /></Field>
          <Field label="Company"><input value={company} onChange={(event) => setCompany(event.target.value)} /></Field>
          <Field label="Job title"><input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} /></Field>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
