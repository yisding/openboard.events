import { z } from "zod";
import { PARTICIPANT_ROLES, participantRoleSchema, sectionIdSchema } from "@/shared/contracts";
import type { BuilderForm } from "./builder-types";

const participantStepRoleSchema = z.object({
  role: participantRoleSchema,
  enabled: z.boolean(),
}).strict();

function uniqueParticipantRoles<T extends z.ZodType>(schema: T) {
  return schema.superRefine((roles, context) => {
    const seen = new Set<string>();
    for (const role of roles as Array<{ role: string }>) {
      if (seen.has(role.role)) {
        context.addIssue({ code: "custom", message: `Duplicate participant role: ${role.role}` });
      }
      seen.add(role.role);
    }
  });
}

/** Persisted legacy/default forms may contain any non-empty supported subset. */
export const participantStepRoleSubsetSchema = uniqueParticipantRoles(
  z.array(participantStepRoleSchema).min(1).max(PARTICIPANT_ROLES.length),
);

/** The endpoint receives one fully canonical role set. */
export const participantStepRolesSchema = uniqueParticipantRoles(
  z.array(participantStepRoleSchema).length(PARTICIPANT_ROLES.length),
);

export const participantStepSectionSchema = z.object({
  title: z.string().trim().min(1).max(255),
  pageHeading: z.string().trim().min(1).max(15),
  descriptionHtml: z.string().max(100_000),
}).strict();

export const participantStepOperationSchema = z.object({
  operationId: z.uuid(),
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
  roles: BuilderForm["participantRoles"],
): BuilderForm["participantRoles"] {
  const parsed = participantStepRoleSubsetSchema.parse(roles);
  const byRole = new Map(parsed.map((role) => [role.role, role.enabled]));
  return PARTICIPANT_ROLES.map((role) => ({
    role,
    enabled: role === "speaker" || byRole.get(role) === true,
  }));
}

/** Stable identity proof for the exact normalized operation stored with its snapshot. */
export function participantStepFingerprint(rawOperation: ParticipantStepOperation): string {
  const operation = participantStepOperationSchema.parse(rawOperation);
  return JSON.stringify([
    operation.expectedUpdatedAt,
    operation.sectionId,
    normalizeParticipantStepRoles(operation.participantRoles),
    operation.section,
  ]);
}
