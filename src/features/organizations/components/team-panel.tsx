"use client";

import { AlertTriangle, KeyRound, Mail, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import {
  eventAccessOverviewDtoSchema,
  organizationInvitationDtoSchema,
  manageableEventAccessDtoSchema,
  memberRoleSchema,
  organizationDtoSchema,
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
import { LoadFailure } from "@/shared/ui/app/load-failure";
import { SkeletonText } from "@/shared/ui/app/skeleton";
import { Button, EmptyState, Field, Modal, Select, StatusBadge } from "@/shared/ui/ui-kit";
// The same authored labels the role badge two rows over renders, so the select
// and the badge can never disagree on what a role is called.
import { STATUS_BADGES } from "@/shared/ui/status-badge";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError, isDefinitiveWriteFailure } from "@/shared/lib/errors";
import { LocalTime } from "@/shared/ui/app/local-time";

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
type TeamWriteRecovery =
  | { action: "role"; member: OrganizationMemberDTO; requestedRole: MemberRole }
  | { action: "remove"; member: OrganizationMemberDTO }
  | { action: "invite"; email: string }
  | { action: "revoke"; invitation: OrganizationInvitationDTO }
  | { action: "event-role"; member: OrganizationMemberDTO; event: ManageableEventAccessDTO; requestedRole: AssignableEventRole }
  | { action: "event-remove"; member: OrganizationMemberDTO; event: ManageableEventAccessDTO };

const organizationMembershipSchema = organizationDtoSchema.extend({ role: memberRoleSchema });

function recoveryDescription(recovery: TeamWriteRecovery): string {
  switch (recovery.action) {
    case "role": return `${recovery.member.email}'s organization role changed`;
    case "remove": return `${recovery.member.email}'s organization access was removed`;
    case "invite": return `an invitation was sent to ${recovery.email}`;
    case "revoke": return `the invitation to ${recovery.invitation.email} was revoked`;
    case "event-role": return `${recovery.member.email}'s access to ${recovery.event.eventName} changed`;
    case "event-remove": return `${recovery.member.email}'s access to ${recovery.event.eventName} was removed`;
  }
}

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
  const [teamWriteBusy, setTeamWriteBusy] = useState(false);
  const [membershipRecovery, setMembershipRecovery] = useState<TeamWriteRecovery | null>(null);
  const [authorityChangedRole, setAuthorityChangedRole] = useState<MemberRole | null>(null);
  const [checkingTeam, setCheckingTeam] = useState(false);
  const eventAccessRequest = useRef(0);
  const teamWriteInFlight = useRef(false);

  const canManage = currentRole === "owner" || currentRole === "organizer";
  const teamWritesLocked = teamWriteBusy || membershipRecovery !== null || authorityChangedRole !== null;

  const beginTeamWrite = useCallback((): boolean => {
    if (teamWriteInFlight.current || membershipRecovery !== null || authorityChangedRole !== null) return false;
    teamWriteInFlight.current = true;
    setTeamWriteBusy(true);
    return true;
  }, [authorityChangedRole, membershipRecovery]);

  const endTeamWrite = useCallback((): void => {
    teamWriteInFlight.current = false;
    setTeamWriteBusy(false);
  }, []);

  const recognizeSelfDemotion = useCallback(async (recovery: TeamWriteRecovery, error: unknown): Promise<boolean> => {
    if (
      recovery.action !== "role"
      || recovery.member.userId !== currentUserId
      || recovery.requestedRole !== "reviewer"
      || !isAppError(error)
      || error.code !== "FORBIDDEN"
    ) return false;
    try {
      const organizations = await api("organizations", z.array(organizationMembershipSchema));
      const current = organizations.find((organization) => organization.id === organizationId);
      if (current?.role !== recovery.requestedRole) return false;
      setMembers((rows) => rows.map((member) => member.userId === currentUserId
        ? { ...member, role: current.role }
        : member));
      setMembershipRecovery(null);
      setAuthorityChangedRole(current.role);
      toast(`Your organization role is currently ${current.role}. Return to your organizations to continue with your current access.`);
      return true;
    } catch {
      return false;
    }
  }, [currentUserId, organizationId, toast]);

  const reconcileMembership = useCallback(async (recovery: TeamWriteRecovery): Promise<boolean> => {
    try {
      const membersRequest = api(`organizations/${organizationId}/members`, z.array(organizationMemberDtoSchema));
      if (recovery.action === "invite" || recovery.action === "revoke") {
        const [latestMembers, latestInvitations] = await Promise.all([
          membersRequest,
          api(`organizations/${organizationId}/invitations`, z.array(organizationInvitationDtoSchema)),
        ]);
        setMembers(latestMembers);
        setInvitations(latestInvitations);
        setMembershipRecovery(null);
        const email = recovery.action === "invite" ? recovery.email : recovery.invitation.email;
        const current = latestInvitations.find((invitation) => invitation.email.toLowerCase() === email.toLowerCase());
        if (current) {
          setInviting(false);
          toast(`Team checked: ${email} currently has a pending ${current.role} invitation.`);
        } else {
          toast(`Team checked: there is currently no pending invitation for ${email}.`);
        }
        return true;
      }
      if (recovery.action === "event-role" || recovery.action === "event-remove") {
        const [latestMembers, accessOverview] = await Promise.all([
          membersRequest,
          api(`events/${recovery.event.eventId}/access`, eventAccessOverviewDtoSchema),
        ]);
        setMembers(latestMembers);
        const authoritativeMember = accessOverview.members.find((member) => member.userId === recovery.member.userId);
        const authoritativeRole = authoritativeMember?.role ?? null;
        setEventAccess((rows) => rows.map((row) => row.eventId === recovery.event.eventId
          ? { ...row, role: authoritativeRole }
          : row));
        setEventAccessDraft((draft) => ({
          ...draft,
          [recovery.event.eventId]: authoritativeRole === "reviewer" ? "reviewer" : "organizer",
        }));
        if (recovery.action === "event-remove") setPendingAccessRemoval(null);
        setMembershipRecovery(null);
        const access = authoritativeRole ? `${authoritativeRole} access` : "no access";
        toast(`Team checked: ${recovery.member.email} currently has ${access} to ${recovery.event.eventName}.`);
        return true;
      }
      const latest = await membersRequest;
      setMembers(latest);
      setMembershipRecovery(null);
      const current = latest.find((member) => member.userId === recovery.member.userId);
      toast(current
        ? `Team checked: ${recovery.member.email} currently has the ${current.role} organization role.`
        : `Team checked: ${recovery.member.email} is not currently an organization member.`);
      return true;
    } catch (error) {
      if (await recognizeSelfDemotion(recovery, error)) return true;
      setMembershipRecovery(recovery);
      return false;
    }
  }, [organizationId, recognizeSelfDemotion, toast]);

  async function checkTeam(): Promise<void> {
    if (!membershipRecovery || checkingTeam) return;
    setCheckingTeam(true);
    try {
      if (!await reconcileMembership(membershipRecovery)) {
        toast("The team still couldn’t be checked. Restore your connection and try again.", { kind: "error" });
      }
    } finally {
      setCheckingTeam(false);
    }
  }

  const changeRole = useCallback(async (member: OrganizationMemberDTO, role: MemberRole) => {
    if (role === member.role || !beginTeamWrite()) return;
    setMembers((current) => current.map((row) => row.userId === member.userId ? { ...row, role } : row));
    try {
      await api(`organizations/${organizationId}/members/${member.userId}`, organizationMemberDtoSchema.pick({ userId: true, role: true }), { method: "PATCH", body: { role } });
      toast(`${member.email} is now ${role}`);
    } catch (caught) {
      if (isDefinitiveWriteFailure(caught)) {
        setMembers((current) => current.map((row) => row.userId === member.userId ? { ...row, role: member.role } : row));
        toast(caught.message, { kind: "error" });
      } else if (!await reconcileMembership({ action: "role", member, requestedRole: role })) {
        toast("That role change is unconfirmed. Restore your connection, then check the team before making another access change.", { kind: "error" });
      }
    } finally {
      endTeamWrite();
    }
  }, [beginTeamWrite, endTeamWrite, organizationId, reconcileMembership, toast]);

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
    if (!accessMember || eventAccessBusy || !beginTeamWrite()) return;
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
      if (!row.role) {
        setMembers((current) => current.map((member) => member.userId === accessMember.userId
          ? { ...member, eventAccessCount: member.eventAccessCount + 1 }
          : member));
      }
      toast(`${accessMember.email} now has ${updated.role} access to ${row.eventName}`);
    } catch (caught) {
      if (isDefinitiveWriteFailure(caught)) {
        toast(caught.message, { kind: "error" });
      } else if (!await reconcileMembership({
        action: "event-role",
        member: accessMember,
        event: row,
        requestedRole,
      })) {
        toast("That event access change is unconfirmed. Restore your connection, then check the team before making another access change.", { kind: "error" });
      }
    } finally {
      setEventAccessBusy(null);
      endTeamWrite();
    }
  }

  async function removeEventAccess() {
    if (!accessMember || !pendingAccessRemoval || eventAccessBusy || !beginTeamWrite()) return;
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
      setMembers((current) => current.map((member) => member.userId === accessMember.userId
        ? { ...member, eventAccessCount: Math.max(0, member.eventAccessCount - 1) }
        : member));
      toast(`${accessMember.email} no longer has access to ${row.eventName}`);
      setPendingAccessRemoval(null);
    } catch (caught) {
      if (isDefinitiveWriteFailure(caught)) {
        toast(caught.message, { kind: "error" });
      } else if (!await reconcileMembership({ action: "event-remove", member: accessMember, event: row })) {
        toast("That event access removal is unconfirmed. Restore your connection, then check the team before making another access change.", { kind: "error" });
      }
    } finally {
      setEventAccessBusy(null);
      endTeamWrite();
    }
  }

  async function confirmRemove() {
    if (!pendingRemove || !beginTeamWrite()) return;
    const removed = pendingRemove;
    setMembers((current) => current.filter((row) => row.userId !== removed.userId));
    setPendingRemove(null);
    try {
      await api(`organizations/${organizationId}/members/${removed.userId}`, removedSchema, { method: "DELETE" });
      toast(`${removed.email} removed from the organization`);
    } catch (caught) {
      if (isDefinitiveWriteFailure(caught)) {
        setMembers((current) => current.some((member) => member.userId === removed.userId)
          ? current
          : [...current, removed].sort((left, right) => left.email.localeCompare(right.email)));
        toast(caught.message, { kind: "error" });
      } else if (!await reconcileMembership({ action: "remove", member: removed })) {
        toast("That removal is unconfirmed. Restore your connection, then check the team before making another access change.", { kind: "error" });
      }
    } finally {
      endTeamWrite();
    }
  }

  async function sendInvite() {
    const email = inviteEmail.trim();
    if (!email || busy || !beginTeamWrite()) return;
    setBusy(true);
    try {
      const created = await api(`organizations/${organizationId}/invitations`, z.object({ invitation: organizationInvitationDtoSchema, emailQueued: z.boolean() }), {
        method: "POST",
        body: { email, role: inviteRole },
      });
      setInvitations((current) => [created.invitation, ...current.filter((row) => row.email !== created.invitation.email)]);
      toast(created.emailQueued ? `Invitation sent to ${email}` : `Invitation queued for ${email}`);
      setInviting(false);
      setInviteEmail("");
      setInviteRole("organizer");
    } catch (caught) {
      if (isDefinitiveWriteFailure(caught)) {
        toast(caught.message, { kind: "error" });
      } else if (!await reconcileMembership({ action: "invite", email })) {
        toast("That invitation is unconfirmed. Restore your connection, then check the team before making another access change.", { kind: "error" });
      }
    } finally {
      setBusy(false);
      endTeamWrite();
    }
  }

  async function confirmRevoke() {
    if (!pendingRevoke || !beginTeamWrite()) return;
    const revoked = pendingRevoke;
    setInvitations((current) => current.filter((row) => row.id !== revoked.id));
    setPendingRevoke(null);
    try {
      await api(`organizations/${organizationId}/invitations/${revoked.id}`, revokedSchema, { method: "DELETE" });
      toast(`Invitation to ${revoked.email} revoked`);
    } catch (caught) {
      if (isDefinitiveWriteFailure(caught)) {
        setInvitations((current) => [revoked, ...current]);
        toast(caught.message, { kind: "error" });
      } else if (!await reconcileMembership({ action: "revoke", invitation: revoked })) {
        toast("That invitation revoke is unconfirmed. Restore your connection, then check the team before making another access change.", { kind: "error" });
      }
    } finally {
      endTeamWrite();
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
        ? <Select aria-label={`Role for ${row.original.name || row.original.email}`} value={row.original.role} onChange={(event) => void changeRole(row.original, event.target.value as MemberRole)} disabled={teamWritesLocked || (row.original.userId === currentUserId && currentRole !== "owner")}>
            {ROLES.map((role) => <option key={role} value={role}>{STATUS_BADGES[role].label}</option>)}
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
              <Button variant="secondary" size="sm" onClick={() => void openEventAccess(row.original)} disabled={teamWritesLocked}><KeyRound size={14} /> Event access</Button>
            )}
            <Button variant="danger" size="sm" onClick={() => setPendingRemove(row.original)} disabled={teamWritesLocked || row.original.userId === currentUserId}>Remove</Button>
          </div>
        : null,
    },
  ], [canManage, currentUserId, currentRole, changeRole, openEventAccess, teamWritesLocked]);

  const invitationColumns = useMemo<Array<ColumnDef<OrganizationInvitationDTO, unknown>>>(() => [
    { id: "email", header: "Invited", accessorKey: "email" },
    { id: "role", header: "Role", cell: ({ row }) => <StatusBadge value={row.original.role} /> },
    { id: "expiresAt", header: "Expires", cell: ({ row }) => <LocalTime instant={row.original.expiresAt} style="date" /> },
    { id: "actions", header: "", cell: ({ row }) => canManage ? <Button variant="danger" size="sm" disabled={teamWritesLocked} onClick={() => setPendingRevoke(row.original)}>Revoke</Button> : null },
  ], [canManage, teamWritesLocked]);

  return <>
    {membershipRecovery && (
      <div className="locked-banner" role="alert">
        <AlertTriangle size={17} />
        <div>
          <b>Team access is unconfirmed</b>
          <span>
            We couldn’t confirm whether {recoveryDescription(membershipRecovery)}.
            Restore your connection, then check the team before making another access change.
          </span>
        </div>
        <Button size="sm" variant="secondary" disabled={checkingTeam} onClick={() => void checkTeam()}>
          {checkingTeam ? "Checking…" : "Check team"}
        </Button>
      </div>
    )}
    {authorityChangedRole && (
      <div className="locked-banner" role="alert">
        <AlertTriangle size={17} />
        <div>
          <b>Your Team access changed</b>
          <span>Your organization role is now {authorityChangedRole}. Return to your organizations to continue with the access you currently have.</span>
        </div>
        <Link className="button button-secondary button-sm" href="/organizations">View organizations</Link>
      </div>
    )}
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
        <p>Invited by email, through Openboard’s own outbox — no separate mailer.</p>
      </header>
      <DataTable
        columns={invitationColumns}
        data={invitations}
        getRowId={(invitation) => invitation.id}
        toolbar={canManage ? <Button size="sm" disabled={teamWritesLocked} onClick={() => setInviting(true)}><UserPlus size={15} /> Invite teammate</Button> : undefined}
        empty={<EmptyState icon={<Mail size={20} />} title="No pending invitations" description="Invite a teammate to this workspace. Event owners grant access to specific events separately." />}
      />
    </section>

    <Modal
      open={inviting}
      onClose={() => (busy ? undefined : setInviting(false))}
      title="Invite a teammate"
      description="They’ll get an email with a link to join this workspace. This invitation does not grant access to any event."
      footer={<>
        <Button variant="secondary" onClick={() => setInviting(false)} disabled={busy}>Cancel</Button>
        <Button onClick={() => void sendInvite()} disabled={teamWritesLocked || !inviteEmail.trim()}>{busy ? "Sending…" : "Send invitation"}</Button>
      </>}
    >
      <Field label="Email" required>
        <input type="email" value={inviteEmail} placeholder="teammate@example.com" disabled={teamWritesLocked} onChange={(event) => setInviteEmail(event.target.value)} autoFocus />
      </Field>
      <Field label="Role" required>
        <Select value={inviteRole} disabled={teamWritesLocked} onChange={(event) => setInviteRole(event.target.value as MemberRole)}>
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
      {eventAccessLoading && <SkeletonText lines={3} label="Loading manageable events…" />}
      {eventAccessError && accessMember && (
        <LoadFailure message={eventAccessError} onRetry={() => void openEventAccess(accessMember)} />
      )}
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
            const accessOperationBusy = eventAccessBusy !== null || teamWritesLocked;
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
      body={pendingRemove && pendingRemove.eventAccessCount > 0
        ? `They lose access to this organization workspace, but retain access to ${pendingRemove.eventAccessCount} event${pendingRemove.eventAccessCount === 1 ? "" : "s"}. Review Settings → Access in each event to revoke it.`
        : "They lose access to this organization workspace. They have no separately granted event access in this organization."}
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
