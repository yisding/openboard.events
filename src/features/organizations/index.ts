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
  inviteEventReviewerInputSchema,
  organizationMemberInputSchema,
  eventAccessRoleInputSchema,
  type AcceptOrganizationInvitationInput,
  type ChangeOrganizationMemberRoleInput,
  type CreateOrganizationInput,
  type InviteOrganizationMemberInput,
  type InviteEventReviewerInput,
  type OrganizationMemberInput,
  type EventAccessRoleInput,
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
  getEventAccessOverview,
  getEventAccessOverviewIn,
  listEventAccessMembers,
  listEventAccessMembersIn,
  listManageableEventAccessForMember,
  listManageableEventAccessForMemberIn,
  removeExplicitEventAccess,
  removeExplicitEventAccessIn,
  removeEventAccessMember,
  removeEventAccessMemberIn,
  setExplicitEventAccess,
  setExplicitEventAccessIn,
  setEventAccessMember,
  setEventAccessMemberIn,
  type AssignableEventRole,
} from "./server/event-access";

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
  getOrganizationInvitationDestinationByToken,
  getOrganizationInvitationDestinationByTokenIn,
  inviteEventReviewer,
  inviteEventReviewerIn,
  inviteOrganizationMember,
  inviteOrganizationMemberIn,
  issueOrganizationInvitationTokenIn,
  listPendingEventReviewerInvitations,
  listPendingEventReviewerInvitationsIn,
  listPendingOrganizationEventInvitationsIn,
  listPendingOrganizationInvitations,
  listPendingOrganizationInvitationsIn,
  revokeOrganizationInvitation,
  revokeOrganizationInvitationIn,
  revokeEventReviewerInvitation,
  revokeEventReviewerInvitationIn,
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
