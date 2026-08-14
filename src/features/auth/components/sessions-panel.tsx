"use client";

import { AlertTriangle, LogOut, MonitorSmartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import { DataTable } from "@/shared/ui/app/data-table";
import { Button, EmptyState } from "@/shared/ui/ui-kit";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { type AppError, isAppError } from "@/shared/lib/errors";
import { useGuardedAction, useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";

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
const sessionSummarySchema = z.object({
  id: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
const sessionsSchema = z.array(sessionSummarySchema);

type SessionMutationRecovery =
  | { action: "revoke"; target: AdminSessionSummary; originalIndex: number }
  | { action: "revoke-all" };

function isDefinitiveSessionMutationError(error: unknown): error is AppError {
  return isAppError(error) && error.code !== "INTERNAL";
}

function recoveryCopy(recovery: SessionMutationRecovery): string {
  return recovery.action === "revoke"
    ? "We don’t know whether that session was revoked. The current list may be stale."
    : "We don’t know whether every session was signed out. The current list may be stale.";
}

/**
 * M44 — admin session views over M42's revocable session store
 * (`admin_sessions`). Self-service only — see `authenticatedAuth`'s doc
 * comment in `features/auth/server/guards.ts` for why this never lists or
 * revokes another person's sessions.
 */
export function SessionsPanel({ initialSessions }: { initialSessions: AdminSessionSummary[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const { allowNextNavigation } = useGuardedAction();
  const [sessions, setSessions] = useState(initialSessions);
  const [pendingRevoke, setPendingRevoke] = useState<AdminSessionSummary | null>(null);
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<SessionMutationRecovery | null>(null);
  const locked = busy || recovery !== null;
  useUnsavedWorkGuard(locked, { blocking: locked });

  function goToLogin(message: string) {
    setSessions([]);
    setRecovery(null);
    toast(message);
    allowNextNavigation(() => router.replace("/login"), {
      destination: new URL("/login", window.location.href).href,
    });
  }

  function restoreTarget(operation: Extract<SessionMutationRecovery, { action: "revoke" }>) {
    setSessions((current) => {
      if (current.some((row) => row.id === operation.target.id)) return current;
      const restored = [...current];
      restored.splice(Math.min(operation.originalIndex, restored.length), 0, operation.target);
      return restored;
    });
  }

  async function confirmRevoke() {
    if (!pendingRevoke || locked) return;
    const operation: Extract<SessionMutationRecovery, { action: "revoke" }> = {
      action: "revoke",
      target: pendingRevoke,
      originalIndex: Math.max(0, sessions.findIndex((row) => row.id === pendingRevoke.id)),
    };
    setBusy(true);
    setSessions((current) => current.filter((row) => row.id !== operation.target.id));
    setPendingRevoke(null);
    try {
      await api(`me/sessions/${operation.target.id}`, revokedSchema, { method: "DELETE" });
      toast("Session revoked");
    } catch (caught) {
      if (isAppError(caught) && caught.code === "UNAUTHORIZED") {
        goToLogin("This sign-in is no longer active. Sign in again to continue.");
      } else if (isDefinitiveSessionMutationError(caught)) {
        restoreTarget(operation);
        toast(caught.message, { kind: "error" });
      } else {
        setRecovery(operation);
        toast("Session revocation is unconfirmed. Keep this page open and retry the exact revoke or check sessions.", { kind: "error" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function signOutEverywhere() {
    if (locked) return;
    setSigningOutEverywhere(false);
    setBusy(true);
    try {
      const result = await api("me/sessions/revoke-all", revokedAllSchema, { method: "POST" });
      goToLogin(`Signed out of ${result.revoked} session${result.revoked === 1 ? "" : "s"} — including this one`);
    } catch (caught) {
      if (isAppError(caught) && caught.code === "UNAUTHORIZED") {
        goToLogin("You’re signed out everywhere. Sign in again to continue.");
      } else if (isDefinitiveSessionMutationError(caught)) {
        toast(caught.message, { kind: "error" });
      } else {
        setRecovery({ action: "revoke-all" });
        toast("Sign out everywhere is unconfirmed. Keep this page open and retry the exact action or check sessions.", { kind: "error" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function retryExactAction() {
    if (!recovery || busy) return;
    const operation = recovery;
    setBusy(true);
    try {
      if (operation.action === "revoke") {
        await api(`me/sessions/${operation.target.id}`, revokedSchema, { method: "DELETE" });
        setSessions((current) => current.filter((row) => row.id !== operation.target.id));
        setRecovery(null);
        toast("Session checked — it is no longer active.");
      } else {
        await api("me/sessions/revoke-all", revokedAllSchema, { method: "POST" });
        goToLogin("All sessions are now signed out. Sign in again to continue.");
      }
    } catch (caught) {
      if (isAppError(caught) && caught.code === "UNAUTHORIZED") {
        goToLogin("You’re signed out. Sign in again to continue.");
      } else if (isDefinitiveSessionMutationError(caught)) {
        toast(`${caught.message} The earlier outcome is still unconfirmed; check sessions before leaving.`, { kind: "error" });
      } else {
        toast("The session change is still unconfirmed. Restore your connection, then retry this exact action or check sessions.", { kind: "error" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function checkSessions() {
    if (!recovery || busy) return;
    const operation = recovery;
    setBusy(true);
    try {
      const latest = await api("me/sessions", sessionsSchema);
      setSessions(latest);
      if (operation.action === "revoke") {
        if (latest.some((row) => row.id === operation.target.id)) {
          toast("That session is currently listed, but the earlier revoke may still be finishing. Retry the exact revoke before leaving.", { kind: "error" });
        } else {
          setRecovery(null);
          toast("Sessions checked — that session is not active.");
        }
      } else if (latest.length === 0) {
        goToLogin("All sessions are signed out. Sign in again to continue.");
      } else {
        toast("This sign-in is still active, but the earlier request may still be finishing. Retry exact sign out everywhere before leaving.", { kind: "error" });
      }
    } catch (caught) {
      if (isAppError(caught) && caught.code === "UNAUTHORIZED") {
        goToLogin("You’re signed out. Sign in again to continue.");
      } else if (isDefinitiveSessionMutationError(caught)) {
        toast(`${caught.message} The session change remains unconfirmed.`, { kind: "error" });
      } else {
        toast("Sessions still couldn’t be checked. Restore your connection and try again.", { kind: "error" });
      }
    } finally {
      setBusy(false);
    }
  }

  const columns = useMemo<Array<ColumnDef<AdminSessionSummary, unknown>>>(() => [
    { id: "device", header: "Device", cell: ({ row }) => row.original.userAgent ?? "Unknown device" },
    { id: "ip", header: "IP address", cell: ({ row }) => row.original.ipAddress ?? "—" },
    { id: "createdAt", header: "Signed in", cell: ({ row }) => new Date(row.original.createdAt).toLocaleString() },
    { id: "expiresAt", header: "Expires", cell: ({ row }) => new Date(row.original.expiresAt).toLocaleString() },
    { id: "actions", header: "", cell: ({ row }) => <Button variant="danger" size="sm" disabled={locked} onClick={() => setPendingRevoke(row.original)}>Revoke</Button> },
  ], [locked]);

  return <section className="panel settings-section">
    <header>
      <h2><MonitorSmartphone size={16} /> Active sessions</h2>
      <p>Every device currently signed in as you. Revoking one ends it on the next request — no waiting for it to expire.</p>
    </header>
    {recovery && (
      <div className="locked-banner" role="alert">
        <AlertTriangle size={17} aria-hidden />
        <div>
          <b>Session change unconfirmed</b>
          <span>{recoveryCopy(recovery)} Keep this page open; other session changes and navigation are locked until you safely recover.</span>
        </div>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void retryExactAction()}>
          {busy ? "Retrying…" : recovery.action === "revoke" ? "Retry exact revoke" : "Retry exact sign out"}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void checkSessions()}>
          {busy ? "Checking…" : "Check sessions"}
        </Button>
      </div>
    )}
    <DataTable
      columns={columns}
      data={sessions}
      getRowId={(session) => session.id}
      toolbar={<Button variant="secondary" size="sm" disabled={locked} onClick={() => setSigningOutEverywhere(true)}><LogOut size={15} /> Sign out everywhere</Button>}
      empty={<EmptyState icon={<MonitorSmartphone size={20} />} title="No active sessions" description="This is unexpected while you're viewing this page." />}
    />
    <ConfirmDialog
      open={pendingRevoke !== null && !locked}
      title="Revoke this session?"
      body="That device is signed out immediately."
      confirmLabel="Revoke"
      onConfirm={() => void confirmRevoke()}
      onCancel={() => setPendingRevoke(null)}
    />
    <ConfirmDialog
      open={signingOutEverywhere && !locked}
      title="Sign out everywhere?"
      body="Every device — including this one — is signed out immediately. You'll need to sign in again."
      confirmLabel="Sign out everywhere"
      onConfirm={() => void signOutEverywhere()}
      onCancel={() => setSigningOutEverywhere(false)}
    />
  </section>;
}
