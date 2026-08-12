/**
 * M45 — self-serve onboarding. The guided event-creation flow for a
 * signed-up organization: event basics, vocabulary, first form — replacing
 * the manual provisioning runbook.
 *
 * This feature owns no schema and no independent write path. Its one server
 * export composes M11's `createEventIn` with M43's
 * `assignEventToOrganizationIn` so a self-serve organization's events are
 * scoped to it from creation; the vocabulary and first-form steps in the
 * wizard UI call M11's and M12's own existing routes directly (`POST
 * /api/internal/events/[eventId]/vocab/[kind]`, `POST /api/internal/forms`,
 * `PATCH /api/internal/forms/[formId]`) rather than duplicating them here.
 */
export { provisionOrganizationEvent, provisionOrganizationEventIn } from "./server/provisioning";
export {
  getActiveOrganizationOnboardingForUser,
  getActiveOrganizationOnboardingForUserIn,
  getActiveOrganizationOnboardingIn,
  startOrganizationOnboardingIn,
  updateOrganizationOnboarding,
  updateOrganizationOnboardingIn,
  type ActiveOnboardingProgress,
} from "./server/progress";
export {
  onboardingProgressUpdateSchema,
  onboardingStepSchema,
  type OnboardingProgressUpdate,
  type OnboardingStep,
} from "./progress-types";
