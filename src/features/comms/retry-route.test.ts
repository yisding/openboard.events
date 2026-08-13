import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_COMMUNICATION_RETRY_BATCH, retryFailedCommunicationsInputSchema } from "./schemas";

const routeSource = readFileSync(
  new URL("../../app/api/internal/comms/[eventId]/log/retry/route.ts", import.meta.url),
  "utf8",
);

describe("communication retry route boundary", () => {
  it("requires organizer authorization and passes the URL event scope explicitly", () => {
    expect(routeSource).toContain('adminAuth({ role: "organizer" })');
    expect(routeSource).toContain("retryFailedCommunications(eventIdSchema.parse(eventId), input.logIds)");
  });

  it("accepts at most 50 distinct log rows", () => {
    const ids = Array.from({ length: MAX_COMMUNICATION_RETRY_BATCH + 1 }, (_, index) =>
      `e0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    expect(retryFailedCommunicationsInputSchema.safeParse({ logIds: ids }).success).toBe(false);
    expect(retryFailedCommunicationsInputSchema.safeParse({ logIds: [ids[0], ids[0]] }).success).toBe(false);
  });
});
