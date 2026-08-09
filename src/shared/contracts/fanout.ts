export const TASK_FANOUT_RULE = {
  submissionTargeted: "primary contact only, once per accepted submission (is_primary partial-unique makes this well-defined)",
  contactTargeted: "members of accepted_speakers_v only",
} as const;
