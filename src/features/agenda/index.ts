/**
 * The agenda's server-safe barrel.
 *
 * Everything here is importable from a server component, a route handler or the
 * seed. The client half — the views and their props — lives in `index.client.ts`
 * so a server import can never pull React state into the Worker graph.
 */
export { detectConflicts, toScheduledSession } from "./conflicts";
export type { Conflict, ScheduledSession } from "./conflicts";

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
  listSessions,
  listSessionsIn,
} from "./server/queries";

export type { MoveSessionInput, SaveSessionInput } from "./server/mutations";
export {
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
  saveSession,
  saveSessionInputSchema,
  saveSessionIn,
} from "./server/mutations";

export { agendaAuth } from "./server/guards";
