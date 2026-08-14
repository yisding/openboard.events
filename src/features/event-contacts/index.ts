/** Canonical event-contact identity write contract. */
export type { ContactPatch } from "./server/contacts";
export { getOrCreateContact, updateContactFields } from "./server/contacts";
export type {
  OrganizationContactResolution,
  UserContactLinkSource,
  UserContactResolution,
} from "./server/identity-links";
export {
  linkUserContactIn,
  resolveOrganizationContactForEventContactIn,
  resolveUserContactIn,
} from "./server/identity-links";
