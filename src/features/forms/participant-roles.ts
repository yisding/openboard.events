import { z } from "zod";
import { PARTICIPANT_ROLES, participantRoleSchema, type ParticipantRole } from "@/shared/contracts";

export const secondaryParticipantRoleSchema = participantRoleSchema.exclude(["speaker"]);
export type SecondaryParticipantRole = Exclude<ParticipantRole, "speaker">;

export const participantRoleSettingsSchema = z.array(z.object({
  role: participantRoleSchema,
  enabled: z.boolean(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
})).max(PARTICIPANT_ROLES.length);

export type ParticipantRoleSetting = z.infer<typeof participantRoleSettingsSchema>[number];

/** The signed-in submitter is always the one primary speaker. Configuration
 * controls only which additional participant roles the form accepts. */
export function enabledSecondaryParticipantRoles(settings: unknown): SecondaryParticipantRole[] {
  const parsed = participantRoleSettingsSchema.parse(settings);
  const enabled = new Set(parsed.filter((setting) => setting.enabled).map((setting) => setting.role));
  return PARTICIPANT_ROLES.filter((role): role is SecondaryParticipantRole => role !== "speaker" && enabled.has(role));
}
