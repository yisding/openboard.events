/**
 * Server barrel for the events feature. Every downstream module's dropdowns
 * (CFP Track/Format/Tags, routing-rule targets, evaluation scope, agenda room
 * columns, embed filters) read their options from the `list*`/`getEventVocabulary`
 * exports below.
 */
export {
  EVENT_TYPES,
  createEventInputSchema,
  eventDetailsPatchSchema,
  formatInputSchema,
  reorderVocabBodySchema,
  roomInputSchema,
  tagInputSchema,
  trackInputSchema,
  updateEventBodySchema,
  VOCAB_KINDS,
  VOCAB_LABELS,
  vocabInputSchemaFor,
  vocabItemInputSchema,
  vocabItemPatchSchema,
  vocabKindSchema,
  type CreateEventInput,
  type EventType,
  type UpdateEventInput,
  type VocabInput,
  type VocabKind,
  type VocabPatch,
} from "./schemas";

export {
  getEvent,
  getEventBySlug,
  getEventIn,
  getEventBySlugIn,
  getEventVocabulary,
  getEventVocabularyIn,
  listEvents,
  listEventsIn,
  listFormats,
  listFormatsIn,
  listRooms,
  listRoomsIn,
  listTags,
  listTagsIn,
  listTracks,
  listTracksIn,
  listVocab,
  listVocabIn,
} from "./server/queries";

export {
  createEvent,
  createEventIn,
  createVocabItem,
  createVocabItemIn,
  deleteVocabItem,
  deleteVocabItemIn,
  reorderVocab,
  reorderVocabIn,
  patchVocabItem,
  patchVocabItemIn,
  saveVocabItem,
  saveVocabItemIn,
  updateEvent,
  updateEventIn,
} from "./server/mutations";

export { eventsHubAuth } from "./server/guards";
export { eventManagementHref } from "./access";
export { eventLifecycle, groupEventsByLifecycle, orderEventsByLifecycle, type EventLifecycle } from "./event-lifecycle";
