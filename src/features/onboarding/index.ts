/**
 * M45 — self-serve onboarding. The guided event-creation flow for a
 * signed-up organization: event basics, vocabulary, first form — replacing
 * the manual provisioning runbook.
 *
 * This feature owns no schema and no independent write path. Its one server
 * export calls M11's `createEventIn` with the organization on the initial
 * INSERT so a self-serve organization's events are scoped from creation;
 * the vocabulary and first-form steps in the
 * wizard UI call M11's and M12's own existing routes directly (`POST
 * /api/internal/events/[eventId]/vocab/[kind]`, `POST /api/internal/forms`,
 * `PATCH /api/internal/forms/[formId]`) rather than duplicating them here.
 */
export {
  provisionEventForActor,
  provisionEventForActorIn,
  provisionOrganizationEvent,
  provisionOrganizationEventIn,
} from "./server/provisioning";
export {
  getActiveOrganizationOnboardingForUser,
  getActiveOrganizationOnboardingForUserIn,
  getActiveOrganizationOnboardingIn,
  getOrganizationOnboardingForUserByEvent,
  getOrganizationOnboardingForUserByEventIn,
  startOrganizationOnboardingIn,
  updateOrganizationOnboarding,
  updateOrganizationOnboardingIn,
  type ActiveOnboardingProgress,
  type OrganizationOnboardingProgress,
} from "./server/progress";
export {
  onboardingProgressUpdateSchema,
  onboardingStepSchema,
  type OnboardingProgressUpdate,
  type OnboardingStep,
} from "./progress-types";

/**
 * First Fair — the demo event's provisioning. Ten idempotent phases, one HTTP
 * request each, advanced by compare-and-set with the clock frozen for the whole
 * run; plus the two ways a demo world ends — rebuilt at the same deterministic
 * id, or discarded by an owner. The dataset and the phase runners stay private
 * to `server/demo/`: nothing outside this feature needs to know what a phase
 * inserts, only which one is running.
 */
export {
  advanceDemoProvisioning,
  advanceDemoProvisioningIn,
  getDemoProvisionState,
  getDemoProvisionStateIn,
  resetDemo,
  resetDemoIn,
  skipDemoProvisioning,
  skipDemoProvisioningIn,
  type DemoProvisionOptions,
} from "./server/demo/provisioning";
export {
  deleteDemoEventForActor,
  deleteDemoEventForActorIn,
  deleteDemoEventIn,
} from "./server/demo/delete";
export { DEMO_DATASET_VERSION, demoEventId, demoSlug } from "./server/demo/ids";
export {
  DEMO_PHASE_COUNT,
  DEMO_PHASE_LABELS,
  DEMO_RUNNABLE_PHASES,
  demoDeleteRequestSchema,
  demoDeleteResultSchema,
  demoProvisionRequestSchema,
  demoProvisionStateSchema,
  type DemoDeleteRequest,
  type DemoDeleteResult,
  type DemoProvisionRequest,
  type DemoProvisionStateDTO,
  type DemoRunnablePhase,
} from "./demo-schemas";

/**
 * First Fair — the demo event's guided tour. Server state only: the cursor,
 * the achievement log and the one world-snapshot query every armed objective
 * is judged against. The tour *engine* is generic UI in
 * `src/shared/ui/app/guided-tour`, and the *script* is domain data that the
 * event route module assembles, so neither is reachable from here.
 */
export {
  advanceTourCursor,
  advanceTourCursorIn,
  armTourStepIn,
  getDemoTourBootstrap,
  getDemoTourBootstrapIn,
  getTourState,
  getTourStateIn,
  getTourWorldIn,
  recordTourStep,
  recordTourStepIn,
} from "./server/tour";
export {
  DEMO_PROVISION_PHASES,
  demoTourBootstrapSchema,
  TOUR_QUEST_STEP_PREFIX,
  TOUR_STATUSES,
  TOUR_STEP_OUTCOMES,
  tourBaselineSchema,
  tourCursorPatchSchema,
  tourStateSchema,
  tourStatusSchema,
  tourStepRecordSchema,
  tourWorldSchema,
  WORLD_FACT_KEYS,
  worldFactKeySchema,
  type DemoProvisionPhase,
  type DemoTourBootstrap,
  type DemoTourContext,
  type TourBaseline,
  type TourCursorPatch,
  type TourStateDTO,
  type TourStatus,
  type TourStepOutcome,
  type TourStepRecord,
  type TourWorld,
  type WorldFactKey,
} from "./tour-schemas";

/**
 * First Fair — "Start from my demo's setup" (design §5.4). The one place a
 * demo event's *content* crosses into a real one: vocabulary and one form's
 * structure, copied once, by an explicit organizer choice, never a flip of
 * `is_demo` itself.
 */
export {
  copyDemoScaffoldForActor,
  copyDemoScaffoldForActorIn,
  copyDemoScaffoldIn,
  DEMO_SCAFFOLD_TABLES,
  type DemoScaffoldTable,
} from "./server/demo/template-copy";
