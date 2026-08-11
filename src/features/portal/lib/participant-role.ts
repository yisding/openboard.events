import type { ParticipantRole } from "@/shared/contracts";

const PARTICIPANT_ROLE_LABELS: Record<ParticipantRole, string> = {
  speaker: "speaker",
  co_speaker: "co-speaker",
  moderator: "moderator",
  panelist: "panelist",
};

export function participantRoleLabel(role: ParticipantRole): string {
  return PARTICIPANT_ROLE_LABELS[role];
}
