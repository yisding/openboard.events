import { describe, expect, it } from "vitest";
import { resolveSeedHeadshotTarget, wranglerPutArgs } from "../scripts/seed/upload-headshots";

describe("seeded headshot uploads", () => {
  it.each([
    ["local", "sb-files-dev", false],
    ["preview", "sb-files-preview", true],
    ["production", "sb-files", true],
  ] as const)("maps %s to its matching R2 bucket", (appEnv, bucket, remote) => {
    expect(resolveSeedHeadshotTarget({ APP_ENV: appEnv })).toEqual({ bucket, remote });
  });

  it("honors a local bucket override but rejects cross-environment deployed buckets", () => {
    expect(resolveSeedHeadshotTarget({ APP_ENV: "local", R2_BUCKET_NAME: "custom-dev" }))
      .toEqual({ bucket: "custom-dev", remote: false });
    expect(() => resolveSeedHeadshotTarget({ APP_ENV: "preview", R2_BUCKET_NAME: "sb-files" }))
      .toThrow("sb-files-preview");
  });

  it("builds an explicit local or remote Wrangler command", () => {
    expect(wranglerPutArgs({ bucket: "dev", remote: false }, "evt/key.png", "/tmp/key.png"))
      .toEqual(expect.arrayContaining(["r2", "object", "put", "dev/evt/key.png", "--local"]));
    expect(wranglerPutArgs({ bucket: "preview", remote: true }, "evt/key.png", "/tmp/key.png"))
      .toEqual(expect.arrayContaining(["r2", "object", "put", "preview/evt/key.png", "--remote"]));
  });

  it("rejects an unclassified target", () => {
    expect(() => resolveSeedHeadshotTarget({})).toThrow("APP_ENV");
  });
});
