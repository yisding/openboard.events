import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertWebWorkerAbsent, webWorkerName } from "../../scripts/check-worker-bootstrap";

describe("first Worker bootstrap guard", () => {
  it("maps only the canonical web Worker names", () => {
    expect(webWorkerName("preview")).toBe("sb-web-preview");
    expect(webWorkerName("production")).toBe("sb-web");
  });

  it("allows the bypass only after an authenticated 404 proves absence", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    await expect(assertWebWorkerAbsent("preview", "account", "token", fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/account/workers/scripts/sb-web-preview/script-settings",
      { headers: { Authorization: "Bearer token" } },
    );
  });

  it("rejects existing Workers and ambiguous Cloudflare failures", async () => {
    await expect(assertWebWorkerAbsent(
      "production",
      "account",
      "token",
      async () => Response.json({ success: true }),
    )).rejects.toThrow("already exists");
    await expect(assertWebWorkerAbsent(
      "production",
      "account",
      "token",
      async () => new Response(null, { status: 403 }),
    )).rejects.toThrow("could not prove");
  });

  it("rejects the bypass for jobs before invoking any deployment tool", () => {
    const result = spawnSync(
      "bash",
      [resolve("scripts/deploy-cloudflare.sh"), "jobs", "preview"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ALLOW_MISSING_DEPLOY_SECRETS: "1",
          APP_BASE_URL: "https://sb-web-preview.yi-ding.workers.dev",
        },
      },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("only valid for the first web Worker bootstrap");
  });
});
