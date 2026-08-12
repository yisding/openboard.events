"use client";

import { Mail, UserPlus, Users } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import {
  organizationInvitationDtoSchema,
  organizationMemberDtoSchema,
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

/**
 * M44 — role management UI over M43's `organization_members`, plus team
 * invitations through the outbox. One panel, two tables: pending invitations
 * are the top half of the same story members are the bottom half of — who
 * can act on this organization, whether they have accepted yet or not.
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
        ? <Button variant="danger" size="sm" onClick={() => setPendingRemove(row.original)} disabled={row.original.userId === currentUserId}>Remove</Button>
        : null,
    },
  ], [canManage, currentUserId, currentRole, changeRole]);

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
        <p>Everyone who can sign in and act on this organization&apos;s events.</p>
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
        empty={<EmptyState icon={<Mail size={20} />} title="No pending invitations" description="Invite a teammate to give them access to this organization." />}
      />
    </section>

    <Modal
      open={inviting}
      onClose={() => (busy ? undefined : setInviting(false))}
      title="Invite a teammate"
      description="They'll get an email with a link to join. Ownership is transferred later, not invited."
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
      </Field>
    </Modal>

    <ConfirmDialog
      open={pendingRemove !== null}
      title={`Remove ${pendingRemove?.email ?? "this member"}?`}
      body="They lose access to every event in this organization immediately. This cannot be undone."
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
  </>;
}
