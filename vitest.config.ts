import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import os from "node:os";

// Most integration test files boot their own PGlite (in-process Postgres)
// instance in `beforeAll`; running many of those at once is memory-hungry
// enough to blow past even a 60s hook timeout on a RAM-constrained host
// (measured: on a 3.7 GiB box, two concurrent workers pushed a PGlite
// bootstrap that is sub-second serially past 60,000ms). A fixed worker count
// is either unsafe on a small box or leaves a big CI runner idle, so size it
// off actual headroom instead: about 2 GiB per worker, capped at the CPU
// count, floored at 1 (fully serial — the previously shipped, known-safe
// behavior — on anything too small to risk a second worker at all).
//
// Use process.availableMemory() rather than os.totalmem(): in a
// memory-limited container the latter reports host-visible RAM, not the
// cgroup limit, which can pick multiple workers in exactly the constrained
// environment this is meant to fall back to serial for. availableMemory()
// is cgroup-aware and reflects actual current headroom; it's only present
// from Node 22 onward, so fall back to os.freemem() on older runtimes.
const availableMemory =
  typeof process.availableMemory === "function" ? process.availableMemory() : os.freemem();
const workers = Math.max(1, Math.min(os.availableParallelism(), Math.floor(availableMemory / (2 * 1024 ** 3))));

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
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
