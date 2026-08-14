/** Canonical event-contact identity write contract. */
export type { ContactPatch } from "./server/contacts";
export { getOrCreateContact, updateContactFields } from "./server/contacts";
export type { UserContactLinkSource, UserContactResolution } from "./server/identity-links";
export { linkUserContactIn, resolveUserContactIn } from "./server/identity-links";
