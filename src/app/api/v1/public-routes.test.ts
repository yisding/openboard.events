import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/env")>()),
  isCredentialFreeLocalDemo: () => true,
}));

import { GET as getEvent } from "./events/[slug]/route";
import { GET as getSchedule } from "./events/[slug]/schedule/route";

const context = { params: Promise.resolve({ slug: "ai-engineer" }) };

describe("public event API", () => {
  it("uses one explicit event DTO in the credential-free demo", async () => {
    const response = await getEvent(new Request("http://localhost/api/v1/events/ai-engineer"), context);
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: Record<string, unknown> };
    expect(Object.keys(payload.data).sort()).toEqual([
      "endsAt", "id", "location", "name", "slug", "startsAt", "timezone", "websiteUrl",
    ]);
    expect(payload.data.slug).toBe("ai-engineer");
    expect(payload.data.websiteUrl).toBeNull();
  });

  it("keeps the local schedule DTO explicit and excludes unconfirmed speakers", async () => {
    const response = await getSchedule(new Request("http://localhost/api/v1/events/ai-engineer/schedule"), context);
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      data: Array<Record<string, unknown> & { speakers: Array<{ id: string }> }>;
      meta: { event: { slug: string; name: string; timezone: string } };
    };
    expect(payload.data.length).toBeGreaterThan(0);
    expect(Object.keys(payload.data[0] ?? {}).sort()).toEqual([
      "descriptionHtml", "endsAt", "format", "id", "room", "speakers", "startsAt", "title", "track", "trackColor",
    ]);
    expect(payload.data.flatMap((session) => session.speakers).map((speaker) => speaker.id)).not.toContain("spk_marcus");
    expect(payload.meta.event).toMatchObject({ slug: "ai-engineer", timezone: "America/Los_Angeles" });
  });
});
