import { describe, expect, it } from "vitest";
import { eventIdSchema } from "@/shared/contracts";
import { dashboardKeys } from "./use-dashboard-overview";

describe("dashboard query keys", () => {
  it("keeps overview reads under the event dashboard prefix", () => {
    const eventId = eventIdSchema.parse("a1000000-0000-4000-8000-000000000001");

    expect(dashboardKeys.overview(eventId)).toEqual([...dashboardKeys.all(eventId), "overview"]);
  });
});
