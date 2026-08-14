import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventId } from "@/shared/contracts";
import {
  PUBLIC_CACHE_RECOVERY_SECONDS,
  publicCacheTag,
} from "../cache-contract";

type UnstableCache = (
  load: () => Promise<unknown>,
  keyParts: string[],
  options: { revalidate: number; tags: string[] },
) => () => Promise<unknown>;

const unstableCache = vi.fn<UnstableCache>((load) => load);
vi.mock("next/cache", () => ({
  unstable_cache: (
    load: () => Promise<unknown>,
    keyParts: string[],
    options: { revalidate: number; tags: string[] },
  ) => {
    unstableCache(load, keyParts, options);
    return load;
  },
}));

const { cachePublicRead } = await import("./cache");
const eventId = "11111111-1111-4111-8111-111111111111" as EventId;

describe("public cached reads", () => {
  beforeEach(() => unstableCache.mockClear());

  it("keys and tags schedule data by event rather than URL", async () => {
    const load = vi.fn().mockResolvedValue({ sessions: [] });
    await expect(cachePublicRead(eventId, "schedule", load)).resolves.toEqual({ sessions: [] });

    expect(load).toHaveBeenCalledOnce();
    expect(unstableCache).toHaveBeenCalledWith(
      load,
      ["openboard-public", eventId, "schedule"],
      {
        revalidate: PUBLIC_CACHE_RECOVERY_SECONDS,
        tags: [publicCacheTag.event(eventId), publicCacheTag.schedule(eventId)],
      },
    );
  });

  it("gives each embed configuration its own event-scoped tag", async () => {
    const load = vi.fn().mockResolvedValue({ enabled: true });
    await cachePublicRead(eventId, "embed:speaker_gallery", load);

    expect(unstableCache).toHaveBeenCalledWith(
      load,
      ["openboard-public", eventId, "embed:speaker_gallery"],
      {
        revalidate: PUBLIC_CACHE_RECOVERY_SECONDS,
        tags: [publicCacheTag.event(eventId), publicCacheTag.embed(eventId, "speaker_gallery")],
      },
    );
  });

  it("tags the speaker-list compatibility read with its legacy dependency", async () => {
    const load = vi.fn().mockResolvedValue({ enabled: true });
    await cachePublicRead(eventId, "embed:speaker_list", load);

    expect(unstableCache).toHaveBeenCalledWith(
      load,
      ["openboard-public", eventId, "embed:speaker_list"],
      {
        revalidate: PUBLIC_CACHE_RECOVERY_SECONDS,
        tags: [
          publicCacheTag.event(eventId),
          publicCacheTag.embed(eventId, "speaker_list"),
          publicCacheTag.embed(eventId, "speaker_gallery"),
        ],
      },
    );
  });
});
