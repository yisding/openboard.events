"use client";

import { ScrollText } from "lucide-react";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { OrganizationAuditLogEntryDTO } from "@/shared/contracts";
import { DataTable } from "@/shared/ui/app/data-table";
import { EmptyState } from "@/shared/ui/ui-kit";
import { LocalTime } from "@/shared/ui/app/local-time";

/**
 * Every action string written by `organizations/server/{invitations,membership}.ts`,
 * in the reader's vocabulary. A key added there without a line here falls back
 * to the raw dotted identifier below, which is not something an owner auditing
 * access should have to decode.
 */
const ACTION_LABELS: Record<string, string> = {
  "member.invited": "Invited a teammate",
  "member.role_changed": "Changed a member's role",
  "member.removed": "Removed a member",
  "invitation.revoked": "Revoked an invitation",
  "invitation.accepted": "Accepted an invitation",
  "reviewer.invited": "Invited a reviewer",
  "reviewer.invitation_revoked": "Revoked a reviewer invitation",
};

/** M44 — admin/audit view over organization membership actions (`organization_audit_log`, `drizzle/0011_user_management.sql`). Read-only: the log is append-only by construction. */
export function AuditLogPanel({ initialEntries }: { initialEntries: OrganizationAuditLogEntryDTO[] }) {
  const columns = useMemo<Array<ColumnDef<OrganizationAuditLogEntryDTO, unknown>>>(() => [
    { id: "createdAt", header: "When", cell: ({ row }) => <LocalTime instant={row.original.createdAt} /> },
    { id: "actor", header: "Who", cell: ({ row }) => row.original.actorEmail ?? "(deleted account)" },
    { id: "action", header: "Action", cell: ({ row }) => ACTION_LABELS[row.original.action] ?? row.original.action },
    { id: "target", header: "Affected", cell: ({ row }) => row.original.targetEmail ?? "—" },
  ], []);

  return <section className="panel settings-section">
    <header>
      <h2><ScrollText size={16} /> Audit log</h2>
      <p>Every invite, role change and removal on this organization, most recent first.</p>
    </header>
    <DataTable
      columns={columns}
      data={initialEntries}
      getRowId={(entry) => entry.id}
      empty={<EmptyState icon={<ScrollText size={20} />} title="Nothing recorded yet" description="Membership changes on this organization will show up here." />}
    />
  </section>;
}
