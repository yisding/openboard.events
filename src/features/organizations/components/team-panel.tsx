"use client";

import { KeyRound, Mail, UserPlus, Users } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import {
  organizationInvitationDtoSchema,
  manageableEventAccessDtoSchema,
  memberRoleSchema,
  organizationMemberDtoSchema,
  eventIdSchema,
  type ManageableEventAccessDTO,
  type MemberRole,
  type OrganizationId,
  type OrganizationInvitationDTO,
  type OrganizationMemberDTO,
  type UserId,
} from "@/shared/contracts";
import { DataTable } from "@/shared/ui/app/data-table";
import { Button, EmptyState, Field, Modal, Select, StatusBadge } from "@/shared/ui/ui-kit";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";

const ROLES: MemberRole[] = ["owner", "organizer", "reviewer"];

// The response schemas passed to `api()` below are the branded contract
// schemas themselves (`@/shared/contracts`), not hand-rolled plain-string
// copies — that is what keeps `changeRole`'s optimistic-update state (typed
// as `OrganizationMemberDTO[]`/`OrganizationInvitationDTO[]`, both branded)
// assignable from what the server actually returns.
const revokedSchema = z.object({ revoked: z.boolean() });
const removedSchema = z.object({ removed: z.boolean() });
const eventAccessResultSchema = z.object({ eventId: eventIdSchema, role: memberRoleSchema });
type AssignableEventRole = "organizer" | "reviewer";

/**
 * M44 — role management UI over M43's `organization_members`, plus team
 * invitations through the outbox. One panel, two tables: pending invitations
 * are the top half of the same story members are the bottom half of — who
 * can enter this organization workspace, whether they have accepted yet or
 * not. Event access remains an explicit, event-scoped grant.
 */
export function TeamPanel({
  organizationId,
  currentUserId,
  currentRole,
  initialMembers,
  initialInvitations,
}: {
  organizationId: OrganizationId;
  currentUserId: UserId;
  currentRole: MemberRole;
  initialMembers: OrganizationMemberDTO[];
  initialInvitations: OrganizationInvitationDTO[];
}) {
  const { toast } = useToast();
  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("organizer");
  const [busy, setBusy] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<OrganizationMemberDTO | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<OrganizationInvitationDTO | null>(null);
  const [accessMember, setAccessMember] = useState<OrganizationMemberDTO | null>(null);
  const [eventAccess, setEventAccess] = useState<ManageableEventAccessDTO[]>([]);
  const [eventAccessDraft, setEventAccessDraft] = useState<Record<string, AssignableEventRole>>({});
  const [eventAccessLoading, setEventAccessLoading] = useState(false);
  const [eventAccessBusy, setEventAccessBusy] = useState<string | null>(null);
  const [eventAccessError, setEventAccessError] = useState("");
  const [pendingAccessRemoval, setPendingAccessRemoval] = useState<ManageableEventAccessDTO | null>(null);
  const eventAccessRequest = useRef(0);

  const canManage = currentRole === "owner" || currentRole === "organizer";

  const changeRole = useCallback(async (member: OrganizationMemberDTO, role: MemberRole) => {
    if (role === member.role) return;
    const previous = members;
    setMembers((current) => current.map((row) => row.userId === member.userId ? { ...row, role } : row));
    try {
      await api(`organizations/${organizationId}/members/${member.userId}`, organizationMemberDtoSchema.pick({ userId: true, role: true }), { method: "PATCH", body: { role } });
      toast(`${member.email} is now ${role}`);
    } catch (caught) {
      setMembers(previous);
      toast(isAppError(caught) ? caught.message : "That role change failed", { kind: "error" });
    }
  }, [members, organizationId, toast]);

  const openEventAccess = useCallback(async (member: OrganizationMemberDTO) => {
    const request = eventAccessRequest.current + 1;
    eventAccessRequest.current = request;
    setAccessMember(member);
    setEventAccess([]);
    setEventAccessError("");
    setEventAccessLoading(true);
    try {
      const rows = await api(
        `organizations/${organizationId}/members/${member.userId}/event-access`,
        z.array(manageableEventAccessDtoSchema),
      );
      if (eventAccessRequest.current !== request) return;
      setEventAccess(rows);
      setEventAccessDraft(Object.fromEntries(rows.map((row) => [
        row.eventId,
        row.role === "reviewer" ? "reviewer" : "organizer",
      ])));
    } catch (caught) {
      if (eventAccessRequest.current !== request) return;
      setEventAccessError(isAppError(caught) ? caught.message : "Event access could not be loaded");
    } finally {
      if (eventAccessRequest.current === request) setEventAccessLoading(false);
    }
  }, [organizationId]);

  function closeEventAccess() {
    eventAccessRequest.current += 1;
    setAccessMember(null);
    setEventAccessLoading(false);
  }

  async function saveEventAccess(row: ManageableEventAccessDTO) {
    if (!accessMember || eventAccessBusy) return;
    const requestedRole = eventAccessDraft[row.eventId] ?? "reviewer";
    setEventAccessBusy(row.eventId);
    try {
      const updated = await api(
        `organizations/${organizationId}/members/${accessMember.userId}/event-access/${row.eventId}`,
        eventAccessResultSchema,
        { method: "PATCH", body: { role: requestedRole } },
      );
      setEventAccess((current) => current.map((entry) => entry.eventId === row.eventId ? { ...entry, role: updated.role } : entry));
      setEventAccessDraft((current) => ({ ...current, [row.eventId]: updated.role === "reviewer" ? "reviewer" : "organizer" }));
      toast(`${accessMember.email} now has ${updated.role} access to ${row.eventName}`);
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "That event access change failed", { kind: "error" });
    } finally {
      setEventAccessBusy(null);
    }
  }

  async function removeEventAccess() {
    if (!accessMember || !pendingAccessRemoval || eventAccessBusy) return;
    const row = pendingAccessRemoval;
    setEventAccessBusy(row.eventId);
    try {
      await api(
        `organizations/${organizationId}/members/${accessMember.userId}/event-access/${row.eventId}`,
        removedSchema,
        { method: "DELETE" },
      );
      setEventAccess((current) => current.map((entry) => entry.eventId === row.eventId ? { ...entry, role: null } : entry));
      setEventAccessDraft((current) => ({ ...current, [row.eventId]: "reviewer" }));
      toast(`${accessMember.email} no longer has access to ${row.eventName}`);
      setPendingAccessRemoval(null);
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "That event access removal failed", { kind: "error" });
    } finally {
      setEventAccessBusy(null);
    }
  }

  async function confirmRemove() {
    if (!pendingRemove) return;
    const removed = pendingRemove;
    setMembers((current) => current.filter((row) => row.userId !== removed.userId));
    setPendingRemove(null);
    try {
      await api(`organizations/${organizationId}/members/${removed.userId}`, removedSchema, { method: "DELETE" });
      toast(`${removed.email} removed from the organization`);
    } catch (caught) {
      setMembers((current) => [...current, removed]);
      toast(isAppError(caught) ? caught.message : "That removal failed", { kind: "error" });
    }
  }

  async function sendInvite() {
    const email = inviteEmail.trim();
    if (!email || busy) return;
    setBusy(true);
    try {
      const created = await api(`organizations/${organizationId}/invitations`, z.object({ invitation: organizationInvitationDtoSchema, emailQueued: z.boolean() }), {
        method: "POST",
        body: { email, role: inviteRole },
      });
      setInvitations((current) => [created.invitation, ...current.filter((row) => row.email !== created.invitation.email)]);
      toast(created.emailQueued ? `Invitation sent to ${email}` : `Invitation created for ${email} — no event to mail it from yet`);
      setInviting(false);
      setInviteEmail("");
      setInviteRole("organizer");
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "That invitation did not send", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function confirmRevoke() {
    if (!pendingRevoke) return;
    const revoked = pendingRevoke;
    setInvitations((current) => current.filter((row) => row.id !== revoked.id));
    setPendingRevoke(null);
    try {
      await api(`organizations/${organizationId}/invitations/${revoked.id}`, revokedSchema, { method: "DELETE" });
      toast(`Invitation to ${revoked.email} revoked`);
    } catch (caught) {
      setInvitations((current) => [revoked, ...current]);
      toast(isAppError(caught) ? caught.message : "That revoke failed", { kind: "error" });
    }
  }

  const memberColumns = useMemo<Array<ColumnDef<OrganizationMemberDTO, unknown>>>(() => [
    { id: "email", header: "Member", accessorKey: "email", meta: { className: "organization-member-name" }, cell: ({ row }) => <div><strong>{row.original.name || row.original.email}</strong>{row.original.name && <small style={{ display: "block" }}>{row.original.email}</small>}</div> },
    {
      id: "role",
      header: "Role",
      accessorKey: "role",
      meta: { className: "organization-member-role" },
      cell: ({ row }) => canManage
        ? <Select value={row.original.role} onChange={(event) => void changeRole(row.original, event.target.value as MemberRole)} disabled={row.original.userId === currentUserId && currentRole !== "owner"}>
            {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
          </Select>
        : <StatusBadge value={row.original.role} />,
    },
    {
      id: "actions",
      header: "",
      meta: { className: "organization-member-actions" },
      cell: ({ row }) => canManage
        ? <div className="team-member-actions">
            {row.original.userId !== currentUserId && (
              <Button variant="secondary" size="sm" onClick={() => void openEventAccess(row.original)}><KeyRound size={14} /> Event access</Button>
            )}
            <Button variant="danger" size="sm" onClick={() => setPendingRemove(row.original)} disabled={row.original.userId === currentUserId}>Remove</Button>
          </div>
        : null,
    },
  ], [canManage, currentUserId, currentRole, changeRole, openEventAccess]);

  const invitationColumns = useMemo<Array<ColumnDef<OrganizationInvitationDTO, unknown>>>(() => [
    { id: "email", header: "Invited", accessorKey: "email" },
    { id: "role", header: "Role", cell: ({ row }) => <StatusBadge value={row.original.role} /> },
    { id: "expiresAt", header: "Expires", cell: ({ row }) => new Date(row.original.expiresAt).toLocaleDateString() },
    { id: "actions", header: "", cell: ({ row }) => canManage ? <Button variant="danger" size="sm" onClick={() => setPendingRevoke(row.original)}>Revoke</Button> : null },
  ], [canManage]);

  return <>
    <section className="panel settings-section organization-members-section">
      <header>
        <h2><Users size={16} /> Members</h2>
        <p>Everyone who can access this organization workspace. Access to each event is assigned separately.</p>
      </header>
      <DataTable
        columns={memberColumns}
        data={members}
        getRowId={(member) => member.userId}
        empty={<EmptyState icon={<Users size={20} />} title="No members yet" description="This should not happen — an organization always has at least one owner." />}
      />
    </section>

    <section className="panel settings-section">
      <header>
        <h2><Mail size={16} /> Pending invitations</h2>
        <p>Invited by email, through Openboard&apos;s own outbox — no separate mailer.</p>
      </header>
      <DataTable
        columns={invitationColumns}
        data={invitations}
        getRowId={(invitation) => invitation.id}
        toolbar={canManage ? <Button size="sm" onClick={() => setInviting(true)}><UserPlus size={15} /> Invite teammate</Button> : undefined}
        empty={<EmptyState icon={<Mail size={20} />} title="No pending invitations" description="Invite a teammate to this workspace. Event owners grant access to specific events separately." />}
      />
    </section>

    <Modal
      open={inviting}
      onClose={() => (busy ? undefined : setInviting(false))}
      title="Invite a teammate"
      description="They'll get an email with a link to join this workspace. This invitation does not grant access to any event."
      footer={<>
        <Button variant="secondary" onClick={() => setInviting(false)} disabled={busy}>Cancel</Button>
        <Button onClick={() => void sendInvite()} disabled={busy || !inviteEmail.trim()}>{busy ? "Sending…" : "Send invitation"}</Button>
      </>}
    >
      <Field label="Email" required>
        <input type="email" value={inviteEmail} placeholder="teammate@example.com" onChange={(event) => setInviteEmail(event.target.value)} autoFocus />
      </Field>
      <Field label="Role" required>
        <Select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as MemberRole)}>
          <option value="organizer">Organizer</option>
          <option value="reviewer">Reviewer</option>
        </Select>
        <small>This role controls organization access only; it does not add them to any event.</small>
      </Field>
    </Modal>

    <Modal
      open={accessMember !== null && pendingAccessRemoval === null}
      onClose={() => (eventAccessBusy ? undefined : closeEventAccess())}
      title={`Event access for ${accessMember?.name || accessMember?.email || "teammate"}`}
      description="Organization membership and event access are separate. You can manage only events where you are already an organizer."
      wide
      footer={<Button variant="secondary" disabled={Boolean(eventAccessBusy)} onClick={closeEventAccess}>Done</Button>}
    >
      {eventAccessLoading && <p className="loading-note" role="status">Loading manageable events…</p>}
      {eventAccessError && <p className="field-error" role="alert">{eventAccessError}</p>}
      {!eventAccessLoading && !eventAccessError && eventAccess.length === 0 && (
        <EmptyState
          icon={<KeyRound size={20} />}
          title="No manageable events"
          description="You must be an organizer of an event before you can grant another teammate access to it."
        />
      )}
      {eventAccess.length > 0 && (
        <div className="team-event-access-list">
          {eventAccess.map((row) => {
            const desired = eventAccessDraft[row.eventId] ?? "reviewer";
            const accessOperationBusy = eventAccessBusy !== null;
            const savingThisRow = eventAccessBusy === row.eventId;
            return (
              <article key={row.eventId}>
                <div>
                  <b>{row.eventName}</b>
                  <small>{row.role ? `Current access: ${row.role}` : "No event access"}</small>
                </div>
                {row.role === "owner"
                  ? <><StatusBadge value="owner" /><small>Ownership is managed inside the event.</small></>
                  : <>
                      <Select
                        aria-label={`Role for ${row.eventName}`}
                        value={desired}
                        disabled={accessOperationBusy}
                        onChange={(event) => setEventAccessDraft((current) => ({ ...current, [row.eventId]: event.target.value as AssignableEventRole }))}
                      >
                        <option value="reviewer" disabled={row.role === "organizer"}>Reviewer</option>
                        <option value="organizer">Organizer</option>
                      </Select>
                      <Button size="sm" disabled={accessOperationBusy || row.role === desired} onClick={() => void saveEventAccess(row)}>
                        {savingThisRow ? "Saving…" : row.role ? "Update" : "Grant access"}
                      </Button>
                      {row.role && <Button size="sm" variant="danger" disabled={accessOperationBusy} onClick={() => setPendingAccessRemoval(row)}>Remove access</Button>}
                    </>}
              </article>
            );
          })}
        </div>
      )}
    </Modal>

    <ConfirmDialog
      open={pendingRemove !== null}
      title={`Remove ${pendingRemove?.email ?? "this member"}?`}
      body="They lose access to this organization workspace. Existing access to specific events is managed separately and is not removed here."
      confirmLabel="Remove"
      onConfirm={() => void confirmRemove()}
      onCancel={() => setPendingRemove(null)}
    />
    <ConfirmDialog
      open={pendingRevoke !== null}
      title={`Revoke the invitation to ${pendingRevoke?.email ?? "this address"}?`}
      body="The link in their email stops working immediately."
      confirmLabel="Revoke"
      onConfirm={() => void confirmRevoke()}
      onCancel={() => setPendingRevoke(null)}
    />
    <ConfirmDialog
      open={pendingAccessRemoval !== null}
      title={`Remove access to ${pendingAccessRemoval?.eventName ?? "this event"}?`}
      body={`${accessMember?.email ?? "This teammate"} will no longer be able to open this event. Their organization membership is unchanged.`}
      confirmLabel="Remove event access"
      onConfirm={removeEventAccess}
      onCancel={() => setPendingAccessRemoval(null)}
    />
  </>;
}
