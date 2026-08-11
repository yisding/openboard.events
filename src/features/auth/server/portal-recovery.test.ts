import { describe, expect, it, vi } from "vitest";
import type { DbOrTx } from "@/db/client";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { sha256 } from "./crypto";
import { createConcurrentPortalRecoverySessionIn } from "./portal";

describe("concurrent portal-login recovery", () => {
  it("mints a fresh session token so the retry response can always set a cookie", async () => {
    const values = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => undefined);
    const db = { insert: vi.fn(() => ({ values })) } as unknown as DbOrTx;
    const contactId = contactIdSchema.parse("97000000-0000-4000-8000-000000000001");
    const eventId = eventIdSchema.parse("97000000-0000-4000-8000-000000000002");

    const recovered = await createConcurrentPortalRecoverySessionIn(
      db,
      { contactId, email: "speaker@example.com" },
      eventId,
      null,
    );

    expect(recovered).toMatchObject({ contactId, email: "speaker@example.com", alreadySignedIn: true });
    expect(recovered.raw).toEqual(expect.any(String));
    expect(recovered.raw.length).toBeGreaterThan(20);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ contactId, eventId, impersonatedByUserId: null }));
    expect(values.mock.calls[0]?.[0]?.tokenHash).toBe(await sha256(recovered.raw));
  });
});
