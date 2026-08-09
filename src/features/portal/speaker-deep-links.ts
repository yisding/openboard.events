import { SPEAKERS_DEEPLINK_PARAMS } from "@/shared/contracts";
import type { SpeakerRecord } from "@/shared/demo/types";

export type SpeakerMissingFilter = (typeof SPEAKERS_DEEPLINK_PARAMS.missing)[number];

export function parseSpeakerMissing(value: string | undefined): SpeakerMissingFilter | null {
  return SPEAKERS_DEEPLINK_PARAMS.missing.find((candidate) => candidate === value) ?? null;
}

export function matchesMissingAsset(speaker: SpeakerRecord, missing: SpeakerMissingFilter | null): boolean {
  if (!missing) return true;
  const bio = speaker.bio.trim().length === 0;
  const headshot = speaker.hasHeadshot !== true;
  if (missing === "bio") return bio;
  if (missing === "headshot") return headshot;
  return bio || headshot;
}
