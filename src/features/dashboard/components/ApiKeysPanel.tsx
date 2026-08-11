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
import { isAppError } from "@/shared/lib/errors";

const summarySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
const createdSchema = summarySchema.omit({ lastUsedAt: true }).extend({ plaintext: z.string() });
const revokedSchema = z.object({ revoked: z.boolean() });

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
  const [busy, setBusy] = useState(false);
  const [justCreated, setJustCreated] = useState<{ name: string; plaintext: string } | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<ApiKeySummary | null>(null);

  async function createKey() {
    const trimmed = label.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const created = await api(`events/${eventId}/api-keys`, createdSchema, { method: "POST", body: { label: trimmed } });
      setKeys((current) => [{ id: created.id, name: created.name, createdAt: created.createdAt, lastUsedAt: null }, ...current]);
      setJustCreated({ name: created.name, plaintext: created.plaintext });
      setCreating(false);
      setLabel("");
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "That key did not create", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function confirmRevoke() {
    if (!pendingRevoke) return;
    const removed = pendingRevoke;
    setKeys((current) => current.filter((key) => key.id !== removed.id));
    setPendingRevoke(null);
    try {
      await api(`events/${eventId}/api-keys/${removed.id}`, revokedSchema, { method: "DELETE" });
      toast(`${removed.name} revoked`);
    } catch {
      setKeys((current) => [removed, ...current]);
      toast("That revoke failed — the key has been restored", { kind: "error" });
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
      cell: ({ row }) => <Button variant="danger" size="sm" onClick={() => setPendingRevoke(row.original)}>Revoke</Button>,
    },
  ], [timezone]);

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
        toolbar={<Button size="sm" onClick={() => setCreating(true)}><Plus size={15} /> Create key</Button>}
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
        onClose={() => (busy ? undefined : setCreating(false))}
        title="Create API key"
        description="Label it by what will use it — you can revoke it later."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void createKey()} disabled={busy || !label.trim()}>{busy ? "Creating…" : "Create key"}</Button>
          </>
        }
      >
        <Field label="Label" required>
          <input
            value={label}
            placeholder="e.g. Judge dashboard script"
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void createKey(); }}
            autoFocus
          />
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
        open={pendingRevoke !== null}
        title={`Revoke ${pendingRevoke?.name ?? "this key"}?`}
        body="Any script or integration using it starts getting 401 immediately. This cannot be undone."
        confirmLabel="Revoke"
        onConfirm={() => void confirmRevoke()}
        onCancel={() => setPendingRevoke(null)}
      />
    </section>
  );
}
