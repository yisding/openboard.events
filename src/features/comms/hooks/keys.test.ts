import { describe, expect, it } from "vitest";
import { commLogIdSchema, contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { commsKeys } from "./keys";

const eventId = eventIdSchema.parse("e5000000-0000-4000-8000-000000000001");

describe("commsKeys", () => {
  it("keeps every event query under one feature prefix", () => {
    const keys = [
      commsKeys.templates(eventId),
      commsKeys.reminderRules(eventId),
      commsKeys.log(eventId, { limit: 500 }),
      commsKeys.logDetail(eventId, commLogIdSchema.parse("c1500000-0000-4000-8000-000000000001")),
      commsKeys.suppressions(eventId),
      commsKeys.deliverability(eventId),
      commsKeys.openAssignments(eventId, contactIdSchema.parse("c5000000-0000-4000-8000-000000000001")),
    ];
    for (const key of keys) expect(key.slice(0, 2)).toEqual(commsKeys.all(eventId));
  });

  it("uses the log prefix to cover filtered lists but not detail reads", () => {
    const prefix = commsKeys.logs(eventId);
    expect(commsKeys.log(eventId, { status: "failed" }).slice(0, prefix.length)).toEqual(prefix);
    expect(commsKeys.logDetail(eventId, null).slice(0, prefix.length)).not.toEqual(prefix);
  });
});
