import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventId } from "@/shared/contracts";
import { publicCacheTag } from "../cache-contract";

const revalidateTag = vi.fn<(tag: string) => void>();
vi.mock("next/cache", () => ({ revalidateTag: (tag: string) => revalidateTag(tag) }));

const {
  revalidatePublicEmbed,
  revalidatePublicEvent,
  revalidatePublicEventMetadata,
} = await import("./revalidate");

const eventId = "11111111-1111-4111-8111-111111111111" as EventId;

describe("public domain invalidation", () => {
  beforeEach(() => {
    revalidateTag.mockReset();
  });

  it("invalidates schedule and speaker data without enumerating route aliases", async () => {
    await revalidatePublicEvent(eventId, ["schedule", "speakers", "schedule"], "req-1");

    expect(revalidateTag.mock.calls.map(([tag]) => tag)).toEqual([
      publicCacheTag.schedule(eventId),
      publicCacheTag.speakers(eventId),
    ]);
    expect(revalidateTag.mock.calls.flat().join(" ")).not.toMatch(/\/e\/|\/embed\//u);
  });

  it("invalidates shared event metadata independently", async () => {
    await revalidatePublicEventMetadata(eventId, "req-2");
    expect(revalidateTag).toHaveBeenCalledExactlyOnceWith(publicCacheTag.event(eventId));
  });

  it.each([
    "session_list",
    "agenda",
    "schedule_itinerary",
    "speaker_list",
    "speaker_gallery",
  ] as const)("invalidates the %s embed configuration and its composed content", async (contentType) => {
    await revalidatePublicEmbed(eventId, contentType, "req-3");
    expect(revalidateTag.mock.calls.map(([tag]) => tag)).toEqual([
      publicCacheTag.embed(eventId, contentType),
      contentType.startsWith("speaker_")
        ? publicCacheTag.speakers(eventId)
        : publicCacheTag.schedule(eventId),
    ]);
  });

  it("never fails an already committed mutation when invalidation fails", async () => {
    revalidateTag.mockImplementation(() => {
      throw new Error("tag cache unavailable");
    });

    await expect(revalidatePublicEvent(eventId, ["schedule"], "req-4")).resolves.toBeUndefined();
    await expect(revalidatePublicEventMetadata(eventId, "req-5")).resolves.toBeUndefined();
    await expect(revalidatePublicEmbed(eventId, "agenda", "req-6")).resolves.toBeUndefined();
  });
});
