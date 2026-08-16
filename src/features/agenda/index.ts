/**
 * The agenda's server-safe barrel.
 *
 * Everything here is importable from a server component, a route handler or the
 * seed. The client half — the views and their props — lives in `index.client.ts`
 * so a server import can never pull React state into the Worker graph.
 */
export { detectConflicts, toScheduledSession } from "./conflicts";
export type { Conflict, ScheduledSession } from "./conflicts";
export { agendaKeys } from "./hooks/keys";
export { announceBundleSchema } from "./schemas";
export type { AnnounceBundle, AnnounceSpeakerLink } from "./schemas";
export { getAnnounceBundle, getAnnounceBundleIn } from "./server/announce";

// M54 — the pure placement planner and its server composition.
export {
  isCandidateLegal,
  suggestPlacements,
} from "./lib/suggest-placements";
export type {
  LegalityVerdict,
  PlacedSuggestion,
  PlacementCandidate,
  PlannerBlackout,
  PlannerDayWindow,
  PlannerRoom,
  PlannerSession,
  RejectionCounts,
  SuggestPlacementsInput,
  SuggestPlacementsResult,
  UnplacedReason,
  UnplacedSuggestion,
} from "./lib/suggest-placements";
export { applyPlacements, applyPlacementsIn, previewPlacements, previewPlacementsIn } from "./server/placements";

export type { AgendaVocabulary, SessionFilters, SpeakerOption } from "./server/queries";
export {
  getMySessions,
  getMySessionsIn,
  getSchedulableSessions,
  getSchedulableSessionsIn,
  getSession,
  getSessionIn,
  listAgendaVocabulary,
  listAgendaVocabularyIn,
  listSessionContentRevisions,
  listSessionContentRevisionsIn,
  listSessionPlacementRevisions,
  listSessionPlacementRevisionsIn,
  listSessions,
  listSessionsIn,
} from "./server/queries";

export type { MoveSessionInput, SaveSessionInput } from "./server/mutations";
export {
  bulkPromoteSubmissions,
  bulkPromoteSubmissionsIn,
  bulkSetPublished,
  bulkSetPublishedIn,
  deleteSession,
  deleteSessionIn,
  moveSession,
  moveSessionInputSchema,
  moveSessionInTx,
  notifySchedule,
  promoteSubmission,
  promoteSubmissionIn,
  restoreSessionContent,
  restoreSessionContentIn,
  saveSession,
  createSessionInputSchema,
  saveSessionInputSchema,
  saveSessionIn,
} from "./server/mutations";

export { agendaAuth } from "./server/guards";
