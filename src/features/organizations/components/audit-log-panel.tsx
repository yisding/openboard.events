"use client";

import Link from "next/link";
import { ScrollText } from "lucide-react";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { OrganizationAuditLogEntryDTO } from "@/shared/contracts";
import { DataTable } from "@/shared/ui/app/data-table";
import { EmptyState } from "@/shared/ui/ui-kit";
import { LocalTime } from "@/shared/ui/app/local-time";

/**
 * Every action string written through `recordOrganizationAuditEventIn`, in the
 * reader's vocabulary. A key added there without a line here falls back to the
 * raw dotted identifier below, which is not something an owner auditing access
 * should have to decode — `demo.provisioned` reached this table verbatim
 * because the first four writers all lived in this feature and the `demo.*`
 * ones do not.
 */
const ACTION_LABELS: Record<string, string> = {
  "member.invited": "Invited a teammate",
  "member.role_changed": "Changed a member's role",
  "member.removed": "Removed a member",
  "invitation.revoked": "Revoked an invitation",
  "invitation.accepted": "Accepted an invitation",
  "reviewer.invited": "Invited a reviewer",
  "reviewer.invitation_revoked": "Revoked a reviewer invitation",
  "demo.provisioned": "Built the sample event",
  "demo.reset": "Reset the sample event",
  "demo.deleted": "Deleted the sample event",
  "demo.scaffold_copied": "Copied the sample event's setup",
};

/**
 * Who or what the entry is about. Membership actions name a person; the
 * `demo.*` and reviewer actions name an event, which used to render as "—"
 * even though the id was sitting in the row's metadata the whole time. A
 * deleted event keeps its id and loses its name, so the id is what shows —
 * it is the only handle left on the thing the entry is evidence of.
 */
function AffectedCell({ entry }: { entry: OrganizationAuditLogEntryDTO }) {
  if (entry.targetEmail) return <>{entry.targetEmail}</>;
  if (!entry.targetEventId) return <>—</>;
  if (!entry.targetEventName) return <span className="mono-cell">{entry.targetEventId}</span>;
  return <Link href={`/events/${entry.targetEventId}`}>{entry.targetEventName}</Link>;
}

/** M44 — admin/audit view over organization membership actions (`organization_audit_log`, `drizzle/0011_user_management.sql`). Read-only: the log is append-only by construction. */
export function AuditLogPanel({ initialEntries }: { initialEntries: OrganizationAuditLogEntryDTO[] }) {
  const columns = useMemo<Array<ColumnDef<OrganizationAuditLogEntryDTO, unknown>>>(() => [
    { id: "createdAt", header: "When", cell: ({ row }) => <LocalTime instant={row.original.createdAt} /> },
    { id: "actor", header: "Who", cell: ({ row }) => row.original.actorEmail ?? "(deleted account)" },
    { id: "action", header: "Action", cell: ({ row }) => ACTION_LABELS[row.original.action] ?? row.original.action },
    { id: "target", header: "Affected", cell: ({ row }) => <AffectedCell entry={row.original} /> },
  ], []);

  return <section className="panel settings-section">
    <header>
      <h2><ScrollText size={16} /> Audit log</h2>
      <p>Every invite, role change, removal and sample-event action on this organization, most recent first.</p>
    </header>
    <DataTable
      columns={columns}
      data={initialEntries}
      getRowId={(entry) => entry.id}
      empty={<EmptyState icon={<ScrollText size={20} />} title="Nothing recorded yet" description="Membership changes on this organization will show up here." />}
    />
  </section>;
}
