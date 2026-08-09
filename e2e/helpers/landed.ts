/**
 * The skip-removal schedule from M10 step 1, as code rather than as a comment.
 *
 * Every unlanded step in the six specs is gated on an entry here. Flip an entry
 * to `true` when its module merges to `main` **and** the spec steps it gates
 * have real bodies — most steps are still placeholder `async () => {}` stubs
 * (M10's remaining work), and flipping a gate over empty steps reports vacuous
 * green on specs that define checkpoints (cfp-submit *is* CP2's bar). Nothing
 * else in the suite hard-codes a module name, so this table is the single
 * place the schedule can go stale.
 */
export const MODULES = {
  M09: { landed: false, what: "seed orchestrator" },
  M11: { landed: false, what: "events + vocab" },
  M12: { landed: false, what: "form builder core" },
  M15: { landed: false, what: "public CFP wizard (merged+deployed; spec steps unimplemented)" },
  M16: { landed: false, what: "submit pipeline (merged+deployed; spec steps unimplemented)" },
  M17: { landed: false, what: "abstracts table (reads merged; spec steps unimplemented)" },
  M18: { landed: false, what: "submission decide/notify UI (server half merged in #57)" },
  M21: { landed: false, what: "portal shell (merged; spec steps unimplemented)" },
  M22: { landed: false, what: "speaker profile" },
  M25: { landed: false, what: "task runtime" },
  M28: { landed: false, what: "sessions CRUD" },
  M29: { landed: false, what: "conflict engine" },
  M31: { landed: false, what: "agenda views" },
  M32: { landed: false, what: "public schedule + gallery" },
  M33: { landed: false, what: "embed shells" },
  M34: { landed: false, what: "comms outbox dispatcher (merged+proven; spec steps unimplemented)" },
  M40: { landed: false, what: "public API (deployed; spec steps unimplemented)" },
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
