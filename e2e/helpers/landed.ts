/**
 * The skip-removal schedule from M10 step 1, as code rather than as a comment.
 *
 * Every unlanded step in the six specs is gated on an entry here. Flip an entry
 * to `true` when its module merges to `main` **and** the spec steps it gates
 * have real bodies — flipping a gate over an empty `async () => {}` step reports
 * vacuous green on specs that define checkpoints (cfp-submit *is* CP2's bar).
 * Nothing else in the suite hard-codes a module name, so this table is the
 * single place the schedule can go stale.
 *
 * All 17 are `true` as of the change that replaced the last placeholder step
 * body. Every entry below names the steps it now gates; a module whose feature
 * regresses out of the tree goes back to `false` *together with* the steps that
 * assert on it, never on its own.
 */
export const MODULES = {
  M09: { landed: true, what: "seed orchestrator — all eight per-feature bodies real" },
  M11: { landed: true, what: "events + vocab (create/validate/vocabulary steps)" },
  M12: { landed: true, what: "form builder core (builder → public link steps)" },
  M15: { landed: true, what: "public CFP wizard (whole cfp-submit spine)" },
  M16: { landed: true, what: "submit pipeline (draft, hidden-answer strip, LIMIT_REACHED)" },
  M17: { landed: true, what: "abstracts table (tab counts, drawer answers)" },
  M18: { landed: true, what: "submission decide/notify (queue + notify steps)" },
  M21: { landed: true, what: "portal shell (portal login, home counts)" },
  M22: { landed: true, what: "speaker profile (bio counter + server refusal)" },
  M25: { landed: true, what: "task runtime (manual + file-request completion)" },
  M28: { landed: true, what: "sessions CRUD (edit-dialog placement, publish)" },
  M29: { landed: true, what: "conflict engine (badge delta, half-open intervals)" },
  M31: { landed: true, what: "agenda views (all six views over one conflict array)" },
  M32: { landed: true, what: "public schedule + gallery (render + leakage steps)" },
  M33: { landed: true, what: "embed shells (frame-ancestors, no X-Frame-Options)" },
  M34: { landed: true, what: "comms outbox dispatcher (one log row per submission)" },
  M40: { landed: true, what: "public API (published-only rows matching the page)" },
  // M50's code is merged and the preview already runs a build carrying
  // migration 0004, so the deployment is no longer what this gate waits on:
  // the *data* is. The spec drives Round 2 — blind, windowed, typed — and reads
  // a blind payload that has to both contain the "Approach" answer and omit the
  // "Employer" one, and `sb-test` was seeded before either existed. `pnpm seed`
  // now tops both up in place rather than needing a wipe, so this flips once
  // that run is confirmed against the preview's own database.
  M50: { landed: false, what: "review operations — needs sb-test reseeded with Round 2 and the blind-review questions" },
  // M51's code is merged, but this gate is about *deployed* evidence: the
  // spec adds/imports/invites/uploads/bulk-emails against the real preview
  // and reads communication_logs back, so it flips only once the preview
  // runs a build that carries migration 0008.
  M51: { landed: false, what: "speaker roster operations — needs a preview deployed with drizzle/0008" },
  // M54's code is merged and its PGlite suite is green, but this gate is
  // about *deployed* evidence too: the spec previews and applies a real
  // placement against the preview's own schedule and blackout rows, so it
  // flips once that run is confirmed against a deployed preview.
  M54: { landed: false, what: "assisted agenda placement — needs deployed preview/apply evidence" },
  // M52's code is merged (drizzle/0006_content_deliverables.sql) and its
  // PGlite suite is green, but this gate is about *deployed* evidence too:
  // the spec uploads two real versions through the browser, exchanges a
  // comment, bulk-reminds through the real outbox, restores/publishes a
  // session against the real public schedule, and reads back real ZIP bytes
  // from R2 — none of which PGlite or a fixture can stand in for.
  M52: { landed: false, what: "content/deliverables lifecycle — needs a preview deployed with drizzle/0006" },
  // M53's code is merged (no new migration — it reads M32/M33's existing
  // views and the pre-existing `embeds` table/enum) and its own unit/
  // integration coverage is green, but this gate is about *deployed*
  // evidence too: the spec exercises every search/filter/day/detail
  // interaction across all five surfaces, a real localStorage star/reload/
  // export round trip, a genuine cross-origin iframe render, and a
  // parity comparison against the organizer's own admin API — none of
  // which a fixture can stand in for.
  M53: { landed: false, what: "five public widgets + embed parity — needs a deployed preview" },
} as const;

export type ModuleId = keyof typeof MODULES;

/** True when every named module has merged, so the gated steps may run. */
export function landed(...ids: ModuleId[]): boolean {
  return ids.every((id) => MODULES[id].landed);
}

/** The skip reason, naming exactly what is missing. */
export function waitingOn(...ids: ModuleId[]): string {
  const missing = ids.filter((id) => !MODULES[id].landed);
  return `waiting on ${missing.map((id) => `${id} (${MODULES[id].what})`).join(", ")}`;
}
