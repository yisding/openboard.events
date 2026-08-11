"use client";

import { LogOut, MonitorSmartphone } from "lucide-react";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import { DataTable } from "@/shared/ui/app/data-table";
import { Button, EmptyState } from "@/shared/ui/ui-kit";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";

// Server-provided props, not user input parsed off the wire — so this is a
// plain type, not a zod schema (unlike `revokedSchema`/`revokedAllSchema`
// below, which validate what `api()` gets back from a mutation).
export type AdminSessionSummary = {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
};
const revokedSchema = z.object({ revoked: z.boolean() });
const revokedAllSchema = z.object({ revoked: z.number() });

/**
 * M44 — admin session views over M42's revocable session store
 * (`admin_sessions`). Self-service only — see `authenticatedAuth`'s doc
 * comment in `features/auth/server/guards.ts` for why this never lists or
 * revokes another person's sessions.
 */
export function SessionsPanel({ initialSessions }: { initialSessions: AdminSessionSummary[] }) {
  const { toast } = useToast();
  const [sessions, setSessions] = useState(initialSessions);
  const [pendingRevoke, setPendingRevoke] = useState<AdminSessionSummary | null>(null);
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);

  async function confirmRevoke() {
    if (!pendingRevoke) return;
    const removed = pendingRevoke;
    setSessions((current) => current.filter((row) => row.id !== removed.id));
    setPendingRevoke(null);
    try {
      await api(`me/sessions/${removed.id}`, revokedSchema, { method: "DELETE" });
      toast("Session revoked");
    } catch (caught) {
      setSessions((current) => [...current, removed]);
      toast(isAppError(caught) ? caught.message : "That revoke failed", { kind: "error" });
    }
  }

  async function signOutEverywhere() {
    setSigningOutEverywhere(false);
    try {
      const result = await api("me/sessions/revoke-all", revokedAllSchema, { method: "POST" });
      toast(`Signed out of ${result.revoked} session${result.revoked === 1 ? "" : "s"} — including this one`);
      setSessions([]);
      window.location.href = "/login";
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "That did not complete", { kind: "error" });
    }
  }

  const columns = useMemo<Array<ColumnDef<AdminSessionSummary, unknown>>>(() => [
    { id: "device", header: "Device", cell: ({ row }) => row.original.userAgent ?? "Unknown device" },
    { id: "ip", header: "IP address", cell: ({ row }) => row.original.ipAddress ?? "—" },
    { id: "createdAt", header: "Signed in", cell: ({ row }) => new Date(row.original.createdAt).toLocaleString() },
    { id: "expiresAt", header: "Expires", cell: ({ row }) => new Date(row.original.expiresAt).toLocaleString() },
    { id: "actions", header: "", cell: ({ row }) => <Button variant="danger" size="sm" onClick={() => setPendingRevoke(row.original)}>Revoke</Button> },
  ], []);

  return <section className="panel settings-section">
    <header>
      <h2><MonitorSmartphone size={16} /> Active sessions</h2>
      <p>Every device currently signed in as you. Revoking one ends it on the next request — no waiting for it to expire.</p>
    </header>
    <DataTable
      columns={columns}
      data={sessions}
      getRowId={(session) => session.id}
      toolbar={<Button variant="secondary" size="sm" onClick={() => setSigningOutEverywhere(true)}><LogOut size={15} /> Sign out everywhere</Button>}
      empty={<EmptyState icon={<MonitorSmartphone size={20} />} title="No active sessions" description="This is unexpected while you're viewing this page." />}
    />
    <ConfirmDialog
      open={pendingRevoke !== null}
      title="Revoke this session?"
      body="That device is signed out immediately."
      confirmLabel="Revoke"
      onConfirm={() => void confirmRevoke()}
      onCancel={() => setPendingRevoke(null)}
    />
    <ConfirmDialog
      open={signingOutEverywhere}
      title="Sign out everywhere?"
      body="Every device — including this one — is signed out immediately. You'll need to sign in again."
      confirmLabel="Sign out everywhere"
      onConfirm={() => void signOutEverywhere()}
      onCancel={() => setSigningOutEverywhere(false)}
    />
  </section>;
}
