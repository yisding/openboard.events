import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import os from "node:os";

// Native Postgres is light enough to use every available CPU. The portable
// PGlite fallback still boots one in-process database per integration file;
// running many of those at once is memory-hungry enough to blow past even a
// 60s hook timeout on a RAM-constrained host. Size that fallback off actual
// headroom instead: about 2 GiB per worker, capped at the CPU count, floored at
// 1 (fully serial on anything too small to risk a second worker at all).
//
// Use process.availableMemory() rather than os.totalmem(): in a
// memory-limited container the latter reports host-visible RAM, not the
// cgroup limit, which can pick multiple workers in exactly the constrained
// environment this is meant to fall back to serial for. availableMemory()
// is cgroup-aware and reflects actual current headroom; it's only present
// from Node 22 onward, so fall back to os.freemem() on older runtimes.
const availableMemory =
  typeof process.availableMemory === "function" ? process.availableMemory() : os.freemem();
const usingNativePostgres = Boolean(process.env.TEST_POSTGRES_URL);
const workers = usingNativePostgres
  ? os.availableParallelism()
  : Math.max(1, Math.min(os.availableParallelism(), Math.floor(availableMemory / (2 * 1024 ** 3))));
const nativePostgresAdapter = usingNativePostgres
  ? [{
      find: /^@electric-sql\/pglite$/,
      replacement: fileURLToPath(new URL("./tests/support/postgres-pglite.ts", import.meta.url)),
    }]
  : [];

export default defineConfig({
  resolve: {
    alias: [
      ...nativePostgresAdapter,
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Threads preserve Vitest's per-file isolation while avoiding the process
    // startup and module-loading overhead paid by the default forks pool.
    pool: "threads",
    maxWorkers: workers,
    hookTimeout: 60_000,
    // The default (5s) assumes a fast local Postgres; several tests make a
    // dozen-plus real round trips through PGlite in one `it`, which is easy
    // to exceed once workers are running concurrently instead of alone.
    testTimeout: 20_000,
  },
});
