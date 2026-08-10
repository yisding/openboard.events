import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema, formIdSchema } from "@/shared/contracts";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ eventId: string }>,
  portalGuard: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => mocks.rows }),
      }),
    }),
  },
}));

vi.mock("@/features/auth", () => ({
  portalAuth: () => mocks.portalGuard,
}));

const { formPortalAuth } = await import("./_lib");

const eventId = eventIdSchema.parse("a0000000-0000-4000-8000-000000000001");
const formId = formIdSchema.parse("a0000000-0000-4000-8000-000000000002");

describe("formPortalAuth", () => {
  beforeEach(() => {
    mocks.rows = [{ eventId }];
    mocks.portalGuard.mockReset().mockResolvedValue({ actorId: "contact", role: "portal" });
  });

  it("derives the auth event from the route form", async () => {
    const request = new NextRequest(`https://example.test/api/internal/forms/${formId}/draft`);
    const session = await formPortalAuth(request, null, { formId });

    expect(mocks.portalGuard).toHaveBeenCalledWith(request, eventId, { formId });
    expect(session).toEqual({ actorId: "contact", role: "portal", eventId });
  });

  it("does not authenticate a form that does not exist", async () => {
    mocks.rows = [];
    const request = new NextRequest(`https://example.test/api/internal/forms/${formId}/submit`);

    await expect(formPortalAuth(request, null, { formId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.portalGuard).not.toHaveBeenCalled();
  });
});
