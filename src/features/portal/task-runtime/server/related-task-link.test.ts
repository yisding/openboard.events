import { describe, expect, it } from "vitest";
import { relatedTaskLinkFor } from "./queries";

/**
 * The manual bio task offered nothing but "Mark as complete" — no field, no
 * route to the Profile page that actually owns the bio (#719). This pins the
 * lookup that fixes it: closed and name-keyed, since `portal_tasks` has no
 * key or slug column to derive it from, and narrow enough that an
 * organizer's own "manual" task never picks up a link that isn't its own.
 */
describe("relatedTaskLinkFor", () => {
  it("points the speaker bio task at the Profile page", () => {
    expect(relatedTaskLinkFor("Write your speaker bio", "manual")).toEqual({
      path: "profile",
      label: "Go to your Profile page",
    });
  });

  it("leaves other manual tasks alone, even ones that also mention a bio", () => {
    expect(relatedTaskLinkFor("Confirm your headshot", "manual")).toBeNull();
    expect(relatedTaskLinkFor("Update your bio and shirt size", "manual")).toBeNull();
  });

  it("never links a form or file_request task, even one named exactly like the bio task", () => {
    expect(relatedTaskLinkFor("Write your speaker bio", "form")).toBeNull();
    expect(relatedTaskLinkFor("Write your speaker bio", "file_request")).toBeNull();
  });
});
