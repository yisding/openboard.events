import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * First Fair (design §6.3, Appendix A #5/#6). Five public routes under
 * `src/app/e/[eventSlug]/` (plus their `/embed` twins) each exported a static
 * `const metadata`, which cannot depend on the event row — verified against
 * the tree: there is no `layout.tsx` under `src/app/e/[eventSlug]/` for a
 * shared read to hang off. All ten were converted to `generateMetadata` so a
 * fabricated conference never enters a search index once Chapter 8 publishes
 * it — and a real organizer's public pages are untouched.
 *
 * They read `getPublicEventIsDemo`, not the published DTO. That is the second
 * thing pinned here: `renderEmbedSurface` promises a disabled embed never
 * performs the more expensive public-data query, and `generateMetadata` runs
 * *before* the page discovers the embed is off — so materialising a whole
 * schedule here to pull one boolean out of it would silently make that
 * promise false on every embed request.
 */

const { getPublicEventIsDemoMock, getPublishedScheduleMock, getPublishedSpeakersMock } = vi.hoisted(() => ({
  getPublicEventIsDemoMock: vi.fn(),
  getPublishedScheduleMock: vi.fn(),
  getPublishedSpeakersMock: vi.fn(),
}));

vi.mock("@/features/public/server/public-queries", () => ({
  getPublicEventIsDemo: getPublicEventIsDemoMock,
  getPublishedSchedule: getPublishedScheduleMock,
  getPublishedSpeakers: getPublishedSpeakersMock,
}));

type GenerateMetadata = (args: { params: Promise<{ eventSlug: string }> }) => Promise<{ robots?: { index: boolean; follow: boolean } }>;

const params = Promise.resolve({ eventSlug: "ai-engineer-worlds-fair-demo-a1b2c3d4" });

const MODULES = [
  "@/app/e/[eventSlug]/agenda/page",
  "@/app/e/[eventSlug]/itinerary/page",
  "@/app/e/[eventSlug]/sessions/page",
  "@/app/e/[eventSlug]/gallery/page",
  "@/app/e/[eventSlug]/speakers/page",
  "@/app/embed/[eventSlug]/agenda/page",
  "@/app/embed/[eventSlug]/itinerary/page",
  "@/app/embed/[eventSlug]/sessions/page",
  "@/app/embed/[eventSlug]/gallery/page",
  "@/app/embed/[eventSlug]/speakers/page",
];

describe("public route metadata", () => {
  beforeEach(() => {
    getPublicEventIsDemoMock.mockReset();
    getPublishedScheduleMock.mockReset();
    getPublishedSpeakersMock.mockReset();
  });

  it.each(MODULES)("sets robots: { index: false, follow: false } for a demo event — %s", async (path) => {
    getPublicEventIsDemoMock.mockResolvedValue(true);
    const { generateMetadata } = (await import(path)) as { generateMetadata: GenerateMetadata };
    const metadata = await generateMetadata({ params });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it.each(MODULES)("leaves robots unset for a real event — %s", async (path) => {
    getPublicEventIsDemoMock.mockResolvedValue(false);
    const { generateMetadata } = (await import(path)) as { generateMetadata: GenerateMetadata };
    const metadata = await generateMetadata({ params });
    expect(metadata.robots).toBeUndefined();
  });

  it.each(MODULES)("never materialises published content just to read a flag — %s", async (path) => {
    getPublicEventIsDemoMock.mockResolvedValue(true);
    const { generateMetadata } = (await import(path)) as { generateMetadata: GenerateMetadata };
    await generateMetadata({ params });
    expect(getPublishedScheduleMock).not.toHaveBeenCalled();
    expect(getPublishedSpeakersMock).not.toHaveBeenCalled();
  });

  it("leaves robots unset for an unknown slug — the page itself renders notFound()", async () => {
    getPublicEventIsDemoMock.mockResolvedValue(false);
    const { generateMetadata } = (await import("@/app/e/[eventSlug]/agenda/page")) as { generateMetadata: GenerateMetadata };
    const metadata = await generateMetadata({ params });
    expect(metadata.robots).toBeUndefined();
  });
});
