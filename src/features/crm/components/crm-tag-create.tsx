"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { crmTagDtoSchema, type CrmTagDTO, type OrganizationId } from "@/shared/contracts";
import { Button } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";

/**
 * M55 — the create-a-tag affordance the directory filters and the contact
 * tags panel both promise. The tags POST endpoint always existed; nothing
 * called it, so the empty-state copy pointed at a control that was never
 * built. This is that control: a collapsed chip that expands into a one-field
 * inline form, reused in both surfaces so the copy is true in either place.
 * The parent owns what a fresh tag does next (drop it into the filter list,
 * or turn it on for the open contact) through `onCreated`.
 */
export function CrmTagCreateControl({
  organizationId,
  onCreated,
}: {
  organizationId: OrganizationId;
  onCreated: (tag: CrmTagDTO) => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  function close() {
    setOpen(false);
    setName("");
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const tag = await api(`organizations/${organizationId}/crm/tags`, crmTagDtoSchema, {
        method: "POST",
        body: { name: trimmed },
      });
      await onCreated(tag);
      toast(`Tag “${tag.name}” created`);
      close();
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "That tag could not be created", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="chip crm-chip-add" onClick={() => setOpen(true)}>
        <Plus size={13} /> New tag
      </button>
    );
  }

  return (
    <form
      className="crm-inline-create"
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
    >
      <input
        aria-label="New tag name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Tag name"
        maxLength={60}
        autoFocus
      />
      <Button type="submit" size="sm" disabled={busy || !name.trim()}>{busy ? "Adding…" : "Add"}</Button>
      <button type="button" className="icon-button" aria-label="Cancel new tag" onClick={close} disabled={busy}><X size={15} /></button>
    </form>
  );
}
