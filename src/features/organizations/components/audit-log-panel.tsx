"use client";

import Link from "next/link";
import { ScrollText, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { OrganizationAuditAction, OrganizationAuditLogEntryDTO } from "@/shared/contracts";
import { DataTable } from "@/shared/ui/app/data-table";
import { EmptyState, Select } from "@/shared/ui/ui-kit";
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
 * The invitee's email out of an entry's metadata, for the two actions whose
 * target is a person who has no `users` row yet. `member.invited` and
 * `invitation.revoked` write `{email}` (organizations/server/invitations.ts)
 * but leave `target_user_id` null — there is nobody to join to until the invite
 * is accepted — so the joined `targetEmail` is null and the address the log
 * captured would otherwise never reach the reader. Untyped `jsonb`: only a
 * non-empty string counts.
 */
function metadataEmail(metadata: Record<string, unknown>): string | null {
  const value = metadata.email;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Who or what the entry is about. Membership actions name a person; the
 * `demo.*` and reviewer actions name an event, which used to render as "—"
 * even though the id was sitting in the row's metadata the whole time. A
 * deleted event keeps its id and loses its name, so the id is what shows —
 * it is the only handle left on the thing the entry is evidence of.
 *
 * An invite or a revoke names a person the join cannot reach — they hold no
 * account yet — so its email is read out of the metadata the writer captured.
 */
function AffectedCell({ entry }: { entry: OrganizationAuditLogEntryDTO }) {
  const email = entry.targetEmail ?? metadataEmail(entry.metadata);
  if (email) return <>{email}</>;
  if (!entry.targetEventId) return <>—</>;
  if (!entry.targetEventName) return <span className="mono-cell">{entry.targetEventId}</span>;
  return <Link href={`/events/${entry.targetEventId}`}>{entry.targetEventName}</Link>;
}

const ALL_ACTIONS = "all";

/** M44 — admin/audit view over organization membership actions (`organization_audit_log`, `drizzle/0011_user_management.sql`). Read-only: the log is append-only by construction. */
export function AuditLogPanel({ initialEntries }: { initialEntries: OrganizationAuditLogEntryDTO[] }) {
  const [actorQuery, setActorQuery] = useState("");
  const [action, setAction] = useState<string>(ALL_ACTIONS);

  const columns = useMemo<Array<ColumnDef<OrganizationAuditLogEntryDTO, unknown>>>(() => [
    { id: "createdAt", header: "When", cell: ({ row }) => <LocalTime instant={row.original.createdAt} /> },
    { id: "actor", header: "Who", cell: ({ row }) => row.original.actorEmail ?? "(deleted account)" },
    { id: "action", header: "Action", cell: ({ row }) => actionLabel(row.original.action) },
    { id: "target", header: "Affected", cell: ({ row }) => <AffectedCell entry={row.original} /> },
  ], []);

  // Only the actions the log actually holds become options — the dropdown is a
  // reader's index of what happened on *this* organization, not the full
  // vocabulary, so it never offers a filter that would match nothing. Labelled
  // so it reads the same as the column, ordered so it reads the same as itself.
  const actionOptions = useMemo(() => {
    const present = [...new Set(initialEntries.map((entry) => entry.action))];
    return present
      .map((value) => ({ value, label: actionLabel(value) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [initialEntries]);

  const filtered = useMemo(() => {
    const needle = actorQuery.trim().toLowerCase();
    return initialEntries.filter((entry) => {
      if (action !== ALL_ACTIONS && entry.action !== action) return false;
      if (needle && !(entry.actorEmail ?? "").toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [initialEntries, actorQuery, action]);

  const filtersActive = actorQuery.trim() !== "" || action !== ALL_ACTIONS;
  const empty = filtersActive
    ? <EmptyState icon={<Search size={20} />} title="Nothing matches those filters" description="Clear the actor or action filter to see the rest of the log." />
    : <EmptyState icon={<ScrollText size={20} />} title="Nothing recorded yet" description="Membership changes on this organization will show up here." />;

  return <section className="panel settings-section">
    <header>
      <h2><ScrollText size={16} /> Audit log</h2>
      <p>Every invite, role change, removal and sample-event action on this organization, most recent first.</p>
    </header>
    {initialEntries.length > 0 && (
      <div className="sessions-filters">
        <label>
          <Search size={17} />
          <input
            aria-label="Filter by actor"
            value={actorQuery}
            onChange={(event) => setActorQuery(event.target.value)}
            placeholder="Filter by actor email"
          />
          {actorQuery && <button type="button" aria-label="Clear actor filter" onClick={() => setActorQuery("")}><X size={14} /></button>}
        </label>
        <Select value={action} onChange={(event) => setAction(event.target.value)} aria-label="Filter by action">
          <option value={ALL_ACTIONS}>All actions</option>
          {actionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
      </div>
    )}
    <DataTable
      columns={columns}
      data={filtered}
      getRowId={(entry) => entry.id}
      empty={empty}
    />
  </section>;
}
