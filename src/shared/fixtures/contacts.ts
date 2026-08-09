import { contactDtoSchema } from "@/shared/contracts";

export const CONTACT_FIXTURE = contactDtoSchema.parse({
  id: "00000000-0000-4000-8000-000000000401",
  email: "speaker@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  salutation: null,
  honorific: null,
  pronouns: null,
  gender: null,
  jobTitle: "Engineer",
  company: "Example",
  bioHtml: "<p>Speaker bio</p>",
  headshotFileId: null,
  linkedinUrl: null,
  twitterUrl: null,
  websiteUrl: "https://example.com",
  otherUrl: null,
  confirmationStatus: "confirmed",
  unsubscribedAt: null,
});
