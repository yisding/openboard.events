import { afterEach, describe, expect, it, vi } from "vitest";
import { FormCreateRequestError, requestData } from "./forms-page";

afterEach(() => vi.unstubAllGlobals());

describe("form create request outcomes", () => {
  it("marks a transport failure as ambiguous", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("response lost")));

    await expect(requestData("/forms", { method: "POST" })).rejects.toMatchObject({
      name: "FormCreateRequestError",
      outcomeUnknown: true,
    });
  });

  it("marks an unreadable successful response as ambiguous", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("not json", { status: 200 })));

    await expect(requestData("/forms", { method: "POST" })).rejects.toMatchObject({
      outcomeUnknown: true,
    });
  });

  it("marks a server rejection as definite", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      error: { message: "Name is already in use" },
    }, { status: 409 })));

    await expect(requestData("/forms", { method: "POST" })).rejects.toEqual(
      new FormCreateRequestError("Name is already in use", false),
    );
  });
});
