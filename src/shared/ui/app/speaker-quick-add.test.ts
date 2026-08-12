import { describe, expect, it } from "vitest";
import { speakerCreateBody } from "./speaker-quick-add";

/**
 * `POST /api/internal/speakers/[eventId]` is idempotent on email, and
 * `contactPatchFrom` applies every key it is handed. So a create against an
 * address already on the event is an update — and any blank optional field
 * that rides along erases what that contact already had.
 */
describe("speaker quick-add body", () => {
  it("omits the optional fields the organizer left blank", () => {
    expect(speakerCreateBody({ email: "osei@kwame.example", firstName: "", lastName: "", company: "" }))
      .toEqual({ email: "osei@kwame.example" });
  });

  it("omits whitespace-only fields too", () => {
    expect(speakerCreateBody({ email: "osei@kwame.example", firstName: "   ", lastName: "\t", company: " " }))
      .toEqual({ email: "osei@kwame.example" });
  });

  it("sends what was filled in, trimmed", () => {
    expect(speakerCreateBody({ email: " osei@kwame.example ", firstName: " Amara ", lastName: "Osei", company: "" }))
      .toEqual({ email: "osei@kwame.example", firstName: "Amara", lastName: "Osei" });
  });
});
