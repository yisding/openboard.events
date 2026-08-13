import { afterEach, describe, expect, it, vi } from "vitest";
import { browserSettableUploadHeaders, postJson } from "./file-upload";

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

  it("gives an actionable fallback when the upload API omits an error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", {
      status: 500,
      headers: { "content-type": "application/json" },
    })));

    await expect(postJson("/api/uploads/presign", { filename: "slides.pdf" })).resolves.toEqual({
      ok: false,
      message: "The upload could not be completed. Try again.",
    });
  });

  it("leaves the browser to supply a signed Content-Length header", () => {
    expect(browserSettableUploadHeaders({
      "Content-Type": "application/pdf",
      "Content-Length": "2048",
      "x-amz-meta-checksum": "verified",
    })).toEqual([
      ["Content-Type", "application/pdf"],
      ["x-amz-meta-checksum", "verified"],
    ]);
  });
});
