import { describe, expect, it } from "vitest";
import { organizerCommentInputSchema } from "./mutations";

const legacyPayload = {
  fileRequestId: "d4000000-0000-4000-8000-000000000001",
  contactId: "c4000000-0000-4000-8000-000000000001",
  submissionId: null,
  body: "Legacy tab comment",
};

describe("organizer comment input compatibility", () => {
  it("accepts old loaded clients without an idempotency id", () => {
    expect(organizerCommentInputSchema.parse(legacyPayload)).toEqual(legacyPayload);
  });

  it("preserves the stable id sent by replay-safe clients", () => {
    const id = "e5000000-0000-4000-8000-000000000090";
    expect(organizerCommentInputSchema.parse({ ...legacyPayload, id })).toEqual({ ...legacyPayload, id });
  });
});
