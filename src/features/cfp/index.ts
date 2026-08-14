import {
  saveCfpDraft as savePreparedCfpDraft,
  submitCfpForm as submitPreparedCfpForm,
  type CfpSubmissionCommands,
  type SaveDraftInput,
  type SubmitInput,
} from "@/features/forms/index.cfp";
import { createSubmissionIn, lockSubmissionLimitScopeIn, saveDraftAnswers } from "@/features/submissions/index.cfp";

const submissionCommands: CfpSubmissionCommands = {
  createSubmissionIn: (tx, eventId, input) => (
    createSubmissionIn(tx, eventId, input, { limitScopeAlreadyLocked: true })
  ),
  lockSubmissionLimitScopeIn,
  saveDraftAnswers,
};

/** Application service composing form preparation with submission persistence. */
export function submitCfpForm(input: SubmitInput) {
  return submitPreparedCfpForm(input, submissionCommands);
}

export function saveCfpDraft(input: SaveDraftInput) {
  return savePreparedCfpDraft(input, submissionCommands);
}

export type { ParticipantInput, SaveDraftInput, SubmitInput } from "@/features/forms/index.cfp";
