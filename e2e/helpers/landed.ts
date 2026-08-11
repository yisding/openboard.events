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
  // The five gates below were the *deployed/data* remainders rather than code
  // gaps, and each gate's stated condition is met as of the rev. 13 evidence run
  // (`docs/evidence/rev13-deployed-run.md`): the preview runs a build carrying
  // migrations 0004/0006/0008 — and 0009–0014 — and `sb-test` was wiped and
  // reseeded by this suite's own global setup, which is what tops up Round 2
  // and the two blind-review questions M50's spec reads. That condition is what
  // the header rule above asks for, so all five are `true`.
  //
  // **Open, and the reason this comment is long: `true` here does not mean the
  // gated specs pass.** Only M53 and M54 went green in that run. The other three
  // are open over specs that have never passed end-to-end, so a red run on them
  // is expected, not a regression:
  //
  //  - M50 — blocked on a real app/seed gap, not weather. No seeded reviewer has
  //    a `contacts` row, so `sendReviewRemindersIn` skips every target and the
  //    reminders route answers `{"enqueued":0,"skipped":3}`; `review-operations.
  //    spec.ts:94` cannot pass until M50's provisioning path (or the seed)
  //    creates that contact. Evidence file §8 Finding 1.
  //  - M52 — the browser presign→PUT→finalize succeeds on the preview but
  //    `.portal-uploads` never renders; the defect is localised to `attach()`'s
  //    POST /api/internal/portal/tasks/{id}/upload + router.refresh() path.
  //    Evidence file §1g.
  //  - M51 — no clean run yet: its arrange steps are not idempotent (a duplicate
  //    "Shirt size" field survives between runs), and its one retry hit the
  //    preview's 503s. Evidence file §8 Findings 4 and 6.
  //
  // Each entry names the steps it now gates; a regression sends it back to
  // `false` together with those steps, never on its own. If the next clean rerun
  // does not close M50/M51/M52, those three go back to `false` — see the
  // evidence file's `needs_owner` items 3 and 4.
  M50: { landed: true, what: "review operations (round governance, blind payloads, the reviewer's own queue)" },
  M51: { landed: true, what: "speaker roster operations (manual add, CSV import, invite, bulk email)" },
  M54: { landed: true, what: "assisted agenda placement (preview, apply one row, blacked-out reason)" },
  M52: { landed: true, what: "content/deliverables lifecycle (versions, comments, reminders, ZIP export)" },
  M53: { landed: true, what: "five public widgets + embed parity (interactions, iframe, cacheability)" },
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
