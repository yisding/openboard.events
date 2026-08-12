export * from "./exports.builder";
export type { PipelineResult, RawAnswers } from "./server/pipeline";
export { deriveMappedFields, runSubmitPipeline } from "./server/pipeline";
export { isStructurallyCompatible } from "./server/snapshot-compat";
export {
  getActiveRoutingRules,
  getActiveRoutingRulesIn,
  getCurrentSnapshot,
  getCurrentSnapshotIn,
  getPinnedSnapshot,
  getPinnedSnapshotIn,
} from "./server/snapshots";
export type { PublicForm, PublicFormOpenState } from "./server/public-form";
export { decideOpenState, getPublicForm, getPublicFormIn } from "./server/public-form";

// M13b — the visibility-rule editor and routing-rules panel's admin-facing
// server half. `getActiveRoutingRules` above (M13a/M16's territory) remains
// the only reader the submit pipeline uses; these are the authoring CRUD.
export type { RoutingRuleInput, RoutingRuleIssue, RoutingRuleRow } from "./server/routing-mutations";
export {
  deleteRoutingRule,
  deleteRoutingRuleIn,
  listRoutingRules,
  listRoutingRulesIn,
  reorderRoutingRules,
  reorderRoutingRulesIn,
  saveRoutingRule,
  saveRoutingRuleIn,
} from "./server/routing-mutations";

// M14 — form settings + notifications: the pure open/close-limit twin of the
// SQL `is_form_open()` predicate, and the Settings/Notifications steps'
// server-side save + template-variable validation.
export type { FormAvailability, FormOpenReason, FormOpenStatus } from "./lib/form-open";
export { effectiveLimit, formAvailability, formOpenState } from "./lib/form-open";
export type { NotificationsPatch, SettingsPatch } from "./server/settings-mutations";
export {
  assertValidConfirmationTemplate,
  assertValidSubmissionLimit,
  saveNotificationsStep,
  saveNotificationsStepIn,
  saveSettingsStep,
  saveSettingsStepIn,
} from "./server/settings-mutations";
