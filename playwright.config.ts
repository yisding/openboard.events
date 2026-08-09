import { defineConfig, devices } from "@playwright/test";

/**
 * M10 step 1 — the CP1 skeleton. Six specs exist from the start with their
 * unlanded steps skipped, because a spec that first appears the day its feature
 * lands has never been debugged.
 *
 * Specs run against a real deployed target and the real Neon `sb-test` database
 * (resolutions #6/#7). PGlite stays vitest-only; there is no DB_DRIVER seam
 * behind a running Next server and building one is banned.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One shared sb-test database: parallel workers against one Postgres produce
  // phantom failures that cost more time than they save.
  workers: 1,
  fullyParallel: false,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://sb-web-preview.yi-ding.workers.dev",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
