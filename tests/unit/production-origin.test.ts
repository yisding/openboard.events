import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const productionOrigin = "https://openboard.events";
const retiredWorkerOrigin = "https://sb-web.yi-ding.workers.dev";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("canonical production origin", () => {
  it("keeps monitoring, deploy validation, and auth callbacks on the public custom domain", () => {
    const uptime = source(".github/workflows/uptime.yml");
    const deploy = source("scripts/deploy-cloudflare.sh");
    const wrangler = source("wrangler.jsonc");
    const readme = source("README.md");

    expect(uptime).toContain(`UPTIME_PRODUCTION_URL || '${productionOrigin}'`);
    expect(deploy).toContain(`production) expected_app_base_url="${productionOrigin}"`);
    expect(wrangler).toContain(`"BETTER_AUTH_URL": "${productionOrigin}"`);
    expect(readme).toContain(`export APP_BASE_URL=${productionOrigin}`);

    expect(uptime).not.toContain(retiredWorkerOrigin);
    expect(deploy).not.toContain(retiredWorkerOrigin);
    expect(wrangler).not.toContain(retiredWorkerOrigin);
    expect(readme).not.toContain(retiredWorkerOrigin);
  });
});
