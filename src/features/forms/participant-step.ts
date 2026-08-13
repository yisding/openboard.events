import { z } from "zod";
import { PARTICIPANT_ROLES, participantRoleSchema, sectionIdSchema } from "@/shared/contracts";
import type { BuilderForm } from "./builder-types";

const participantStepRoleSchema = z.object({
  role: participantRoleSchema,
  enabled: z.boolean(),
}).strict();

export const participantStepRolesSchema = z.array(participantStepRoleSchema)
  .length(PARTICIPANT_ROLES.length)
  .superRefine((roles, context) => {
    const seen = new Set<string>();
    for (const role of roles) {
      if (seen.has(role.role)) {
        context.addIssue({ code: "custom", message: `Duplicate participant role: ${role.role}` });
      }
      seen.add(role.role);
    }
  });

export const participantStepSectionSchema = z.object({
  title: z.string().trim().min(1).max(255),
  pageHeading: z.string().trim().min(1).max(15),
  descriptionHtml: z.string().max(100_000),
}).strict();

export const participantStepOperationSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  sectionId: sectionIdSchema,
  participantRoles: participantStepRolesSchema,
  section: participantStepSectionSchema,
}).strict();

export const participantStepInputSchema = participantStepOperationSchema.extend({
  participantReplay: z.boolean().optional(),
}).strict();

export type ParticipantStepOperation = z.infer<typeof participantStepOperationSchema>;

/** Canonical storage/order plus the invariant that the primary speaker exists. */
export function normalizeParticipantStepRoles(
  roles: ParticipantStepOperation["participantRoles"],
): BuilderForm["participantRoles"] {
  const parsed = participantStepRolesSchema.parse(roles);
  const byRole = new Map(parsed.map((role) => [role.role, role.enabled]));
  return PARTICIPANT_ROLES.map((role) => ({
    role,
    enabled: role === "speaker" || byRole.get(role) === true,
  }));
}
