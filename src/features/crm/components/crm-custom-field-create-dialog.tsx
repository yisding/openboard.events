"use client";

import { useState } from "react";
import { crmCustomFieldDtoSchema, type CrmCustomFieldDTO, type OrganizationId } from "@/shared/contracts";
import { Button, Field, Modal, Select } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";

/** Suggest a machine key from the human label so an organizer never has to
 * think about the slug — they still can, but the common case fills itself. */
function keyFromLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 60);
}

/** Keep a hand-edited key inside the same shape the server enforces
 * (`^[a-z0-9][a-z0-9_]*$`): lowercase, drop anything that is not a letter,
 * digit or underscore, and refuse a leading underscore so the field can only
 * ever hold a contract-legal slug rather than round-trip to a 400. */
function normalizeKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]/gu, "").replace(/^_+/u, "").slice(0, 60);
}

/**
 * M55 — define a new CRM custom field. The custom-fields POST endpoint always
 * existed and setting a field on a contact already worked, but no UI ever
 * created one, so the panel could only ever render fields that were seeded
 * some other way. This dialog is the missing definition step: label, an
 * auto-suggested key, text-or-select type, and options for a select.
 */
export function CrmCustomFieldCreateDialog({
  organizationId,
  open,
  onClose,
  onCreated,
}: {
  organizationId: OrganizationId;
  open: boolean;
  onClose: () => void;
  onCreated: (field: CrmCustomFieldDTO) => void;
}) {
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [fieldType, setFieldType] = useState<"text" | "select">("text");
  const [optionsText, setOptionsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const effectiveKey = keyEdited ? key : keyFromLabel(label);

  function reset() {
    setLabel(""); setKey(""); setKeyEdited(false); setFieldType("text"); setOptionsText("");
    setError(null); setFieldErrors({});
  }

  async function create() {
    if (busy || !label.trim() || !effectiveKey) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const options = optionsText.split("\n").map((line) => line.trim()).filter(Boolean);
    try {
      const field = await api(`organizations/${organizationId}/crm/custom-fields`, crmCustomFieldDtoSchema, {
        method: "POST",
        body: { key: effectiveKey, label: label.trim(), fieldType, options: fieldType === "select" ? options : [] },
      });
      onCreated(field);
      toast(`Custom field “${field.label}” created`);
      reset();
      onClose();
    } catch (caught) {
      if (isAppError(caught)) {
        setError(caught.message);
        if (caught.fieldErrors) setFieldErrors(caught.fieldErrors);
      } else {
        setError("That custom field could not be created");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="New custom field"
      description="Define a field once for the organization, then set it on any contact."
      footer={<>
        <Button variant="secondary" onClick={() => { reset(); onClose(); }} disabled={busy}>Cancel</Button>
        <Button onClick={() => void create()} disabled={busy || !label.trim() || !effectiveKey}>{busy ? "Creating…" : "Create field"}</Button>
      </>}
    >
      <div className="form-stack">
        <Field label="Label" required error={fieldErrors.label}>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Dietary needs"
            maxLength={120}
            autoFocus
          />
        </Field>
        <Field label="Key" required hint="Lowercase letters, numbers and underscores. Used in imports and the API." error={fieldErrors.key}>
          <input
            value={effectiveKey}
            onChange={(event) => { setKeyEdited(true); setKey(normalizeKey(event.target.value)); }}
            placeholder="dietary_needs"
            maxLength={60}
          />
        </Field>
        <Field label="Type">
          <Select value={fieldType} onChange={(event) => setFieldType(event.target.value === "select" ? "select" : "text")}>
            <option value="text">Text</option>
            <option value="select">Select (choose one)</option>
          </Select>
        </Field>
        {fieldType === "select" && (
          <Field label="Options" required hint="One per line." error={fieldErrors.options}>
            <textarea value={optionsText} onChange={(event) => setOptionsText(event.target.value)} rows={4} placeholder={"Vegetarian\nVegan\nNone"} />
          </Field>
        )}
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
