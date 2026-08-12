/**
 * Server barrel for the organizations feature (M43 — organization tenancy).
 *
 * This is the schema spine M44 (user management), M47 (data lifecycle) and
 * M49 (billing) hang off. It owns `organizations` and `organization_members`;
 * the guards that read that membership live in `@/features/auth`
 * (`requireOrganizationAdmin`, `organizationAuth`) next to their event-scoped
 * counterparts, so the two scopes' authorization decisions stay in one file.
 */
export {
  acceptOrganizationInvitationInputSchema,
  changeOrganizationMemberRoleInputSchema,
  createOrganizationInputSchema,
  inviteOrganizationMemberInputSchema,
  organizationMemberInputSchema,
  type AcceptOrganizationInvitationInput,
  type ChangeOrganizationMemberRoleInput,
  type CreateOrganizationInput,
  type InviteOrganizationMemberInput,
  type OrganizationMemberInput,
} from "./schemas";

export { eventCreationDestination, manageableOrganizations } from "./event-creation";

export {
  getEventOrganization,
  getEventOrganizationIn,
  getOrganization,
  getOrganizationBySlug,
  getOrganizationBySlugIn,
  getOrganizationIn,
  getOrganizationMemberRole,
  getOrganizationMemberRoleIn,
  listOrganizationEvents,
  listOrganizationEventsForUser,
  listOrganizationEventsForUserIn,
  listOrganizationEventsIn,
  listOrganizationMemberIdsIn,
  listOrganizationMembers,
  listOrganizationMembersIn,
  listOrganizationsForUser,
  listOrganizationsForUserIn,
  resolvePrimaryOrganization,
  resolvePrimaryOrganizationIn,
  type OrganizationEventAccessRow,
  type OrganizationEventRow,
  type OrganizationMembership,
} from "./server/queries";

export {
  assignEventToOrganization,
  assignEventToOrganizationIn,
  createOrganization,
  createOrganizationIn,
  removeOrganizationMember,
  removeOrganizationMemberIn,
  setOrganizationMember,
  setOrganizationMemberIn,
} from "./server/mutations";

// M44 — user management: team invitations, role management and a light
// audit trail, all built on the schema spine this module owns.
export {
  acceptOrganizationInvitationByToken,
  acceptOrganizationInvitationByTokenIn,
  assertOrganizationInvitationTokenForEmailIn,
  inviteOrganizationMember,
  inviteOrganizationMemberIn,
  issueOrganizationInvitationTokenIn,
  listPendingOrganizationInvitations,
  listPendingOrganizationInvitationsIn,
  revokeOrganizationInvitation,
  revokeOrganizationInvitationIn,
} from "./server/invitations";
export {
  listOrganizationAuditLog,
  listOrganizationAuditLogIn,
  recordOrganizationAuditEventIn,
} from "./server/audit";
export {
  changeOrganizationMemberRole,
  changeOrganizationMemberRoleIn,
  removeOrganizationMemberAudited,
  removeOrganizationMemberAuditedIn,
} from "./server/membership";
export {
  provisionOrganizationForNewUser,
  provisionOrganizationForNewUserIn,
} from "./server/signup";
