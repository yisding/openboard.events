import { describe, expect, it, vi } from "vitest";
import { duplicateFormAsDraft, FormDuplicateRequestError } from "./duplicate-form";

describe("duplicateFormAsDraft", () => {
  it("posts to the generic duplicate endpoint and returns the new draft", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      data: { id: "20000000-0000-4000-8000-000000000002", status: "draft" },
    }));

    await expect(duplicateFormAsDraft(
      "10000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000001",
      request,
    )).resolves.toMatchObject({
      id: "20000000-0000-4000-8000-000000000002",
      status: "draft",
    });
    expect(request).toHaveBeenCalledWith(
      "/api/internal/forms/20000000-0000-4000-8000-000000000001/duplicate?eventId=10000000-0000-4000-8000-000000000001",
      { method: "POST" },
    );
  });

  it.each([
    ["transport failure", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("response lost"))],
    ["server failure", vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: "Database unavailable" } }, { status: 503 }))],
    ["unreadable success", vi.fn<typeof fetch>().mockResolvedValue(new Response("not json", { status: 200 }))],
  ])("marks a %s as outcome-unknown", async (_label, request) => {
    await expect(duplicateFormAsDraft("event", "form", request)).rejects.toMatchObject({
      name: "FormDuplicateRequestError",
      outcomeUnknown: true,
    });
  });

  it("preserves a definite client rejection", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      error: { message: "Form not found" },
    }, { status: 404 }));

    await expect(duplicateFormAsDraft("event", "form", request)).rejects.toEqual(
      new FormDuplicateRequestError("Form not found", false),
    );
  });
});
