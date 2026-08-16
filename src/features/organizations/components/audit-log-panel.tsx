"use client";

import Link from "next/link";
import { ScrollText } from "lucide-react";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { OrganizationAuditAction, OrganizationAuditLogEntryDTO } from "@/shared/contracts";
import { DataTable } from "@/shared/ui/app/data-table";
import { EmptyState } from "@/shared/ui/ui-kit";
import { LocalTime } from "@/shared/ui/app/local-time";

/**
 * Every action string written through `recordOrganizationAuditEventIn`, in the
 * reader's vocabulary. `demo.provisioned` reached this table verbatim because
 * the first four writers all lived in this feature and the `demo.*` ones do
 * not; `satisfies` is what stops the next one — the map must cover
 * `OrganizationAuditAction` exactly, so an action added without a label fails
 * the build instead of shipping a dotted identifier to an owner auditing
 * access.
 */
const ACTION_LABELS = {
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
} satisfies Record<OrganizationAuditAction, string>;

/**
 * The union is what today's writers may record; the table renders whatever the
 * append-only log already holds, which can include an action a past deploy
 * wrote under a name since retired. Those still get the raw string — but they
 * are now the only ones that can.
 */
function actionLabel(action: string): string {
  return Object.hasOwn(ACTION_LABELS, action)
    ? ACTION_LABELS[action as OrganizationAuditAction]
    : action;
}

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
    { id: "action", header: "Action", cell: ({ row }) => actionLabel(row.original.action) },
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
