import type { ParticipantRole } from "@/shared/contracts";

const PARTICIPANT_ROLE_LABELS: Record<ParticipantRole, string> = {
  speaker: "speaker",
  co_speaker: "co-speaker",
  moderator: "moderator",
  panelist: "panelist",
};

/** Mid-sentence use only — "You are a {label}". Standalone chips want the sentence-case form below. */
export function participantRoleLabel(role: ParticipantRole): string {
  return PARTICIPANT_ROLE_LABELS[role];
}

/**
 * The same role as a standalone label, so a chip reading "Co-speaker" sits
 * beside "Primary speaker" instead of looking like a leaked enum value.
 */
export function participantRoleChipLabel(role: ParticipantRole): string {
  const label = PARTICIPANT_ROLE_LABELS[role];
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}
