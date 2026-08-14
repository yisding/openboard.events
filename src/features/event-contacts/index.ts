/** Canonical event-contact identity write contract. */
export type { ContactPatch } from "./server/contacts";
export { getOrCreateContact, updateContactFields } from "./server/contacts";
export type { UserContactResolution } from "./server/identity-links";
export { resolveUserContactIn } from "./server/identity-links";
