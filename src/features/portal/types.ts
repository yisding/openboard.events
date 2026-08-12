import type { ConfirmationStatus } from "@/shared/contracts";

/**
 * The view shapes the portal chrome renders against.
 *
 * These two records were originally the browser demo's fixture types. The demo
 * is gone; the shapes stayed because the portal header/footer, the speaker
 * drawer and the deep-link filters are all written against them. They are
 * produced from real rows by `server/shell.ts` (`getPortalShellDataIn`) and
 * `server/admin-speakers.ts` (`contactSpeakerRecord`) — presentation shapes,
 * not database or API contracts, which is why they live in the feature rather
 * than in `@/shared/contracts`.
 */
export type EventRecord = {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  timezone: string;
  city: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  accent: string;
  logoText: string;
  status: "draft" | "live" | "complete";
};

export type SpeakerRecord = {
  id: string;
  eventId: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  title: string;
  bio: string;
  location: string;
  website: string;
  linkedin: string;
  avatar: string;
  avatarColor: string;
  hasHeadshot?: boolean;
  confirmation: ConfirmationStatus;
  profileCompletion: number;
  tags: string[];
};
