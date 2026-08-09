import { afterEach, describe, expect, it, vi } from "vitest";
import { postJson } from "./file-upload";

describe("file upload API requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("converts a rejected fetch into a retryable component error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network unavailable")));

    await expect(postJson("/api/uploads/presign", { filename: "slides.pdf" })).resolves.toEqual({
      ok: false,
      message: "The server could not be reached — check your connection and retry",
    });
  });
});
