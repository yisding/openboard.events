import type { CrmPipelineStage } from "@/shared/contracts";

/**
 * The authored words for the three pipeline stages, in one place so a picker
 * cannot drift from the board column it filters. These stay out of
 * `STATUS_BADGES` deliberately: `won`/`lost` never render as a badge, and that
 * map is the badge vocabulary.
 */
export const STAGE_LABEL: Record<CrmPipelineStage, string> = { open: "Open", won: "Won", lost: "Lost" };
