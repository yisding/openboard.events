import { describe, expect, it, vi } from "vitest";
import { copyText } from "./copy-text";

describe("copyText", () => {
  it("uses the Clipboard API when it succeeds", async () => {
    const writeText = vi.fn(async () => undefined);
    const fallback = vi.fn(() => true);

    await expect(copyText("https://example.com/live", { writeText }, fallback)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://example.com/live");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back after clipboard rejection", async () => {
    const writeText = vi.fn(async () => { throw new Error("denied"); });
    const fallback = vi.fn(() => true);

    await expect(copyText("https://example.com/live", { writeText }, fallback)).resolves.toBe(true);
    expect(fallback).toHaveBeenCalledWith("https://example.com/live");
  });

  it("reports failure when neither copy mechanism works", async () => {
    const writeText = vi.fn(async () => { throw new Error("denied"); });
    await expect(copyText("https://example.com/live", { writeText }, () => false)).resolves.toBe(false);
    await expect(copyText("https://example.com/live", null, () => { throw new Error("unsupported"); })).resolves.toBe(false);
  });
});
