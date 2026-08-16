"use client";

import { Copy, KeyRound, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import type { EventId } from "@/shared/contracts";
import { DataTable } from "@/shared/ui/app/data-table";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Button, EmptyState, Field, Modal } from "@/shared/ui/ui-kit";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isDefinitiveWriteFailure } from "@/shared/lib/errors";
import { useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import {
  API_KEY_LABEL_MAX_LENGTH,
  API_KEY_LABEL_TOO_LONG_MESSAGE,
  apiKeyCreationLabelError,
  newApiKeyCreationOperation,
  type ApiKeyCreationOperation,
} from "../api-key-creation";

const summarySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
const createdSchema = summarySchema.omit({ lastUsedAt: true }).extend({ plaintext: z.string() });
const revokedSchema = z.object({ revoked: z.boolean() });
const keyListSchema = z.array(summarySchema);

export type ApiKeySummary = z.infer<typeof summarySchema>;

/**
 * Event-scoped API key lifecycle (M40). Reads and writes go through
 * `/api/internal/events/[eventId]/api-keys`, guarded by `requireAdmin` the
 * same as every other settings surface — this page never talks to
 * `/api/v1` itself. The plaintext key is shown exactly once, in the create
 * dialog's response, and is never fetched or displayed again afterward.
 */
export function ApiKeysPanel({ eventId, initialKeys, timezone }: { eventId: EventId; initialKeys: ApiKeySummary[]; timezone: string }) {
  const { toast } = useToast();
  const [keys, setKeys] = useState(initialKeys);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [labelError, setLabelError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creationRecovery, setCreationRecovery] = useState<ApiKeyCreationOperation | null>(null);
  const [justCreated, setJustCreated] = useState<{ name: string; plaintext: string } | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<ApiKeySummary | null>(null);
  const labelLength = label.length;
  const labelValidationMessage = apiKeyCreationLabelError(label);
  const creationLocked = creationRecovery !== null || busy;
  useUnsavedWorkGuard(creationLocked, { blocking: creationLocked });

  async function createKey(operation = creationRecovery ?? undefined) {
    if (busy) return;
    let frozen = operation;
    if (!frozen) {
      const validationMessage = apiKeyCreationLabelError(label);
      if (validationMessage) {
        setLabelError(validationMessage);
        toast(validationMessage, { kind: "error" });
        return;
      }
      try {
        frozen = newApiKeyCreationOperation(label);
      } catch {
        const preparationMessage = "Could not prepare a secure API key. Try again.";
        setLabelError(preparationMessage);
        toast(preparationMessage, { kind: "error" });
        return;
      }
    }
    setLabelError(null);
    setBusy(true);
    try {
      const created = await api(`events/${eventId}/api-keys`, createdSchema, { method: "POST", body: frozen });
      setKeys((current) => [
        { id: created.id, name: created.name, createdAt: created.createdAt, lastUsedAt: null },
        ...current.filter((key) => key.id !== created.id),
      ]);
      setJustCreated({ name: created.name, plaintext: created.plaintext });
      setCreationRecovery(null);
      setCreating(false);
      setLabel("");
      setLabelError(null);
    } catch (caught) {
      if (isDefinitiveWriteFailure(caught)) {
        setCreationRecovery(null);
        toast(caught.message, { kind: "error" });
      } else {
        setCreationRecovery(frozen);
        toast("API key creation is unconfirmed. Retry the exact creation when your connection is available.", { kind: "error" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmRevoke() {
    if (!pendingRevoke || creationRecovery) return;
    const removed = pendingRevoke;
    setKeys((current) => current.filter((key) => key.id !== removed.id));
    setPendingRevoke(null);
    try {
      await api(`events/${eventId}/api-keys/${removed.id}`, revokedSchema, { method: "DELETE" });
      toast(`${removed.name} revoked`);
    } catch (caught) {
      // A definitive refusal proves the key is still live, so restoring the row
      // is a fact. Anything else — a transport failure, an INTERNAL — leaves the
      // outcome unknown, and the old bare `catch` restored the row either way
      // while announcing "the key has been restored". A revoke that had in fact
      // committed then showed a leaked key as live in the UI while every
      // integration using it got 401. `isDefinitiveWriteFailure` exists for
      // exactly this split; `createKey` above and the Team panel's member
      // removal both already use it.
      if (isDefinitiveWriteFailure(caught)) {
        setKeys((current) => current.some((key) => key.id === removed.id) ? current : [removed, ...current]);
        toast(caught.message, { kind: "error" });
        return;
      }
      // Outcome unknown: ask the server rather than assert either answer.
      try {
        setKeys(await api(`events/${eventId}/api-keys`, keyListSchema, { method: "GET" }));
        toast("That revoke could not be confirmed. The list above is now current.", { kind: "error" });
      } catch {
        setKeys((current) => current.some((key) => key.id === removed.id) ? current : [removed, ...current]);
        toast("That revoke is unconfirmed. Restore your connection and check this list before assuming the key is still live.", { kind: "error" });
      }
    }
  }

  async function copyPlaintext(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast("Key copied");
    } catch {
      toast("Could not copy — select and copy the key manually", { kind: "error" });
    }
  }

  const columns = useMemo<Array<ColumnDef<ApiKeySummary, unknown>>>(() => [
    { id: "name", header: "Label", accessorKey: "name" },
    { id: "createdAt", header: "Created", accessorKey: "createdAt", cell: ({ row }) => <TzTime instant={row.original.createdAt} tz={timezone} style="date" secondary="time" /> },
    {
      id: "lastUsedAt",
      header: "Last used",
      accessorKey: "lastUsedAt",
      cell: ({ row }) => <TzTime instant={row.original.lastUsedAt} tz={timezone} style="date" secondary="time" />,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button variant="danger" size="sm" onClick={() => setPendingRevoke(row.original)} disabled={creationRecovery !== null || busy}>
          Revoke
        </Button>
      ),
    },
  ], [busy, creationRecovery, timezone]);

  return (
    <section className="panel settings-section">
      <header>
        <h2>API keys</h2>
        <p>
          Bearer keys for <code>/api/v1</code>&apos;s keyed endpoints (submissions, outstanding tasks, stats, comms log),
          scoped to this event only. See <code>docs/api.md</code> for the full reference.
        </p>
      </header>

      <DataTable
        columns={columns}
        data={keys}
        getRowId={(key) => key.id}
        toolbar={<Button size="sm" onClick={() => setCreating(true)} disabled={creationRecovery !== null || busy}><Plus size={15} /> Create key</Button>}
        empty={
          <EmptyState
            icon={<KeyRound size={20} />}
            title="No API keys yet"
            description="Create a key to authorize a script or integration to read this event's keyed data."
          />
        }
      />

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        dismissible={!busy && creationRecovery === null}
        title="Create API key"
        description="Label it by what will use it — you can revoke it later."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)} disabled={busy || creationRecovery !== null}>Cancel</Button>
            <Button onClick={() => void createKey()} disabled={busy || (!creationRecovery && labelValidationMessage !== null)}>
              {busy ? "Checking…" : creationRecovery ? "Retry exact creation" : "Create key"}
            </Button>
          </>
        }
      >
        {creationRecovery && (
          <div className="locked-banner" role="alert">
            <div><b>Creation unconfirmed</b><span>The outcome is unknown, so this window cannot be closed yet. Retry exact creation when your connection is available; it sends the same frozen key details and cannot create a second key.</span></div>
          </div>
        )}
        <Field label="Label" required error={labelError ?? undefined} errorId="api-key-label-error">
          <input
            value={label}
            placeholder="e.g. Judge dashboard script"
            aria-invalid={labelError ? true : undefined}
            aria-describedby={labelError ? "api-key-label-error api-key-label-count" : "api-key-label-count"}
            onChange={(event) => {
              setLabel(event.target.value);
              const validationMessage = apiKeyCreationLabelError(event.target.value);
              setLabelError(validationMessage === API_KEY_LABEL_TOO_LONG_MESSAGE ? validationMessage : null);
            }}
            onKeyDown={(event) => { if (event.key === "Enter") void createKey(); }}
            disabled={busy || creationRecovery !== null}
            autoFocus
          />
          <small id="api-key-label-count">{labelLength} / {API_KEY_LABEL_MAX_LENGTH} characters</small>
        </Field>
      </Modal>

      <Modal
        open={justCreated !== null}
        onClose={() => setJustCreated(null)}
        title="Key created"
        {...(justCreated ? { description: `"${justCreated.name}" — copy it now. You will not see it again.` } : {})}
        footer={<Button onClick={() => setJustCreated(null)}>Done</Button>}
      >
        {justCreated && (
          <div className="field">
            <span>Plaintext key</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code style={{ wordBreak: "break-all", flex: 1 }}>{justCreated.plaintext}</code>
              <Button variant="secondary" size="sm" onClick={() => void copyPlaintext(justCreated.plaintext)}><Copy size={14} /> Copy</Button>
            </div>
            <small>This is the only time this key is shown. Store it in your script&apos;s environment, not in source control.</small>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={pendingRevoke !== null && creationRecovery === null}
        title={`Revoke ${pendingRevoke?.name ?? "this key"}?`}
        body="Any script or integration using it starts getting 401 immediately. This cannot be undone."
        confirmLabel="Revoke"
        onConfirm={() => void confirmRevoke()}
        onCancel={() => setPendingRevoke(null)}
      />
    </section>
  );
}
