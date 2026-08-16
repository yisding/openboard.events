import { z } from "zod";
import { memberRoleSchema } from "./enums";
import { eventIdSchema, organizationAuditLogIdSchema, organizationIdSchema, organizationInvitationIdSchema, userIdSchema } from "./ids";

/**
 * M43 — organization tenancy contracts.
 *
 * Additive: nothing here changes an existing export. In particular
 * `EventDTO` is deliberately untouched — every producer of it would otherwise
 * have to be edited in lockstep, and the event->organization link is read
 * through `getEventOrganization` instead.
 */

const iso = z.iso.datetime();

/**
 * The organization every event created before M43 belongs to, inserted by
 * `drizzle/0010_organization_tenancy.sql` and used as the database DEFAULT of
 * `events.organization_id`. Named here so application code and tests can refer
 * to the backfilled row without re-deriving it from its slug.
 */
export const DEFAULT_ORGANIZATION_ID = organizationIdSchema.parse("d3fa0000-0000-4000-8000-000000000001");

export const organizationDtoSchema = z.object({
  id: organizationIdSchema,
  name: z.string(),
  slug: z.string(),
  createdAt: iso,
});
export type OrganizationDTO = z.infer<typeof organizationDtoSchema>;

/**
 * Membership carries `member_role`, the same `owner > organizer > reviewer`
 * ladder `event_members` uses, so one `roleSatisfies` ranks both scopes.
 */
export const organizationMemberDtoSchema = z.object({
  userId: userIdSchema,
  organizationId: organizationIdSchema,
  email: z.string(),
  name: z.string(),
  role: memberRoleSchema,
  eventAccessCount: z.number().int().nonnegative(),
  createdAt: iso,
});
export type OrganizationMemberDTO = z.infer<typeof organizationMemberDtoSchema>;

/** One organization event whose access the current actor is allowed to manage for a teammate. */
export const manageableEventAccessDtoSchema = z.object({
  eventId: eventIdSchema,
  eventName: z.string(),
  role: memberRoleSchema.nullable(),
});
export type ManageableEventAccessDTO = z.infer<typeof manageableEventAccessDtoSchema>;

/** One current event membership, including former organization teammates. */
export const eventAccessMemberDtoSchema = z.object({
  userId: userIdSchema,
  email: z.string(),
  name: z.string(),
  role: memberRoleSchema,
  organizationMember: z.boolean(),
  canRemove: z.boolean(),
});
export type EventAccessMemberDTO = z.infer<typeof eventAccessMemberDtoSchema>;

/** One current organization teammate who does not yet have event access. */
export const eventAccessGrantCandidateDtoSchema = z.object({
  userId: userIdSchema,
  email: z.string(),
  name: z.string(),
  organizationRole: memberRoleSchema,
});
export type EventAccessGrantCandidateDTO = z.infer<typeof eventAccessGrantCandidateDtoSchema>;

/** Everything Event Settings needs to explain and manage event access. */
export const eventAccessOverviewDtoSchema = z.object({
  members: z.array(eventAccessMemberDtoSchema),
  candidates: z.array(eventAccessGrantCandidateDtoSchema),
  canGrant: z.boolean(),
  grantRestriction: z.string().nullable(),
});
export type EventAccessOverviewDTO = z.infer<typeof eventAccessOverviewDtoSchema>;

/**
 * M44 — a pending or resolved team invitation. Never carries the raw token
 * (only its hash lives at rest, and even that is not read back through this
 * DTO) — accepting one is always a separate, explicit action
 * (`acceptOrganizationInvitation`), never something this listing can do.
 */
export const organizationInvitationDtoSchema = z.object({
  id: organizationInvitationIdSchema,
  organizationId: organizationIdSchema,
  email: z.string(),
  role: memberRoleSchema,
  invitedByUserId: userIdSchema,
  createdAt: iso,
  expiresAt: iso,
  acceptedAt: iso.nullable(),
  revokedAt: iso.nullable(),
});
export type OrganizationInvitationDTO = z.infer<typeof organizationInvitationDtoSchema>;

/**
 * M44 — one row of the organization audit log. `actorUserId`/`targetUserId`
 * are nullable because the underlying `users` row can be deleted out from
 * under a historical entry (`ON DELETE SET NULL`); the log outlives the
 * account.
 */
export const organizationAuditLogEntryDtoSchema = z.object({
  id: organizationAuditLogIdSchema,
  organizationId: organizationIdSchema,
  actorUserId: userIdSchema.nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  targetUserId: userIdSchema.nullable(),
  targetEmail: z.string().nullable(),
  /**
   * The event an entry is about, when its metadata names one — reviewer
   * invitations, invitation acceptances and every `demo.*` action all do.
   * `targetEventName` is resolved at read time and is null once the event is
   * gone (`demo.deleted` is exactly that case), so the id is carried
   * separately: it outlives the row it points at, and it is the only handle an
   * auditor has left on a deleted event.
   */
  targetEventId: eventIdSchema.nullable(),
  targetEventName: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: iso,
});
export type OrganizationAuditLogEntryDTO = z.infer<typeof organizationAuditLogEntryDtoSchema>;
