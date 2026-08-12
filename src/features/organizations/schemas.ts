import { z } from "zod";
import { memberRoleSchema } from "@/shared/contracts";

/**
 * Pure zod schemas for the organizations feature — no server imports, the same
 * split `features/events/schemas.ts` uses, so a client component can import
 * these for `zodResolver` without pulling database code into the bundle.
 */

export const createOrganizationInputSchema = z.object({
  name: z.string().trim().min(1, "Organization name is required").max(200),
  /** Derived from `name` when omitted, exactly as an event's slug is. */
  slug: z.string().trim().max(200).optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationInputSchema>;

export const organizationMemberInputSchema = z.object({
  userId: z.uuid(),
  role: memberRoleSchema,
});
export type OrganizationMemberInput = z.infer<typeof organizationMemberInputSchema>;

/**
 * M44 — team invitations. `role` excludes `"owner"` on purpose: ownership is
 * transferred between existing members (`changeOrganizationMemberRole`), never
 * handed out through an emailed invite — the same refusal
 * `createEventReviewerIn` already makes one scope down ("Ownership is
 * transferred, not invited").
 */
export const inviteOrganizationMemberInputSchema = z.object({
  email: z.email(),
  role: memberRoleSchema.exclude(["owner"]).default("organizer"),
});
export type InviteOrganizationMemberInput = z.infer<typeof inviteOrganizationMemberInputSchema>;

export const changeOrganizationMemberRoleInputSchema = z.object({ role: memberRoleSchema });
export type ChangeOrganizationMemberRoleInput = z.infer<typeof changeOrganizationMemberRoleInputSchema>;

/** Event ownership is transferred inside the event; Team can grant only working roles. */
export const eventAccessRoleInputSchema = z.object({ role: memberRoleSchema.exclude(["owner"]) });
export type EventAccessRoleInput = z.infer<typeof eventAccessRoleInputSchema>;

export const acceptOrganizationInvitationInputSchema = z.object({ token: z.string().min(1) });
export type AcceptOrganizationInvitationInput = z.infer<typeof acceptOrganizationInvitationInputSchema>;
