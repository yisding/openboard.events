import { z } from "zod";
import {
  bulkReminderResultSchema,
  bulkReminderTargetSchema,
  eventIdSchema,
  type BulkReminderResult,
  type BulkReminderTarget,
  type EventId,
} from "@/shared/contracts";

const RECOVERY_VERSION = 1;

export const bulkReminderSurfaceSchema = z.enum(["files", "speakers", "task-matrix"]);
export type BulkReminderSurface = z.infer<typeof bulkReminderSurfaceSchema>;

const bulkReminderResolutionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("result"), result: bulkReminderResultSchema }),
  z.object({ kind: z.literal("error"), message: z.string().min(1).max(500) }),
]);

export const bulkReminderRecoverySchema = z.object({
  version: z.literal(RECOVERY_VERSION),
  eventId: eventIdSchema,
  surface: bulkReminderSurfaceSchema,
  attemptId: z.uuid(),
  targets: z.array(bulkReminderTargetSchema).min(1).max(200),
  resolution: bulkReminderResolutionSchema.optional(),
});

export type BulkReminderRecovery = z.infer<typeof bulkReminderRecoverySchema>;
export type BulkReminderResolution = z.infer<typeof bulkReminderResolutionSchema>;

export type BulkReminderRecoveryLoad =
  | { ok: true; recovery: BulkReminderRecovery }
  | { ok: false; reason: "missing" | "unreadable" };

type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type BulkReminderRecoveryLockManager = {
  request<T>(
    name: string,
    options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: object | null) => T | PromiseLike<T>,
  ): Promise<T>;
};

export type BulkReminderRecoveryLockResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "unavailable" | "busy" };

export function bulkReminderRecoveryStorageKey(eventId: EventId): string {
  return `openboard:bulk-task-reminder:${eventId}`;
}

/** Storage acquisition itself can throw in privacy-restricted browsers. */
export function bulkReminderRecoveryStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function bulkReminderRecoveryLockManager(): BulkReminderRecoveryLockManager | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { locks?: BulkReminderRecoveryLockManager }).locks ?? null;
}

/** Hold the event-wide lock from browser persistence through API settlement. */
export async function withBulkReminderRecoveryLock<T>(
  eventId: EventId,
  lockManager: BulkReminderRecoveryLockManager | null,
  action: () => Promise<T>,
): Promise<BulkReminderRecoveryLockResult<T>> {
  if (!lockManager) return { ok: false, reason: "unavailable" };
  try {
    return await lockManager.request(
      `openboard:bulk-task-reminder-lock:${eventId}`,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => lock ? { ok: true, value: await action() } : { ok: false, reason: "busy" },
    );
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function loadBulkReminderRecovery(
  storage: Pick<RecoveryStorage, "getItem">,
  eventId: EventId,
): BulkReminderRecoveryLoad {
  try {
    const raw = storage.getItem(bulkReminderRecoveryStorageKey(eventId));
    if (raw === null) return { ok: false, reason: "missing" };
    const parsed = bulkReminderRecoverySchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.eventId !== eventId) return { ok: false, reason: "unreadable" };
    return { ok: true, recovery: parsed.data };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

function sameAttempt(left: BulkReminderRecovery, right: BulkReminderRecovery): boolean {
  return left.eventId === right.eventId
    && left.attemptId === right.attemptId
    && left.surface === right.surface
    && JSON.stringify(left.targets) === JSON.stringify(right.targets);
}

/**
 * Persist before POST and verify the value that won. An existing exact attempt
 * may be upgraded with a confirmed resolution, but it can never be replaced
 * by a different selection or batch id.
 */
export function persistBulkReminderRecovery(
  storage: Pick<RecoveryStorage, "getItem" | "setItem">,
  recovery: BulkReminderRecovery,
): boolean {
  try {
    const candidate = bulkReminderRecoverySchema.parse(recovery);
    const loaded = loadBulkReminderRecovery(storage, candidate.eventId);
    if (!loaded.ok && loaded.reason !== "missing") return false;
    if (loaded.ok && !sameAttempt(loaded.recovery, candidate)) return false;
    if (loaded.ok && loaded.recovery.resolution && !candidate.resolution) return false;
    if (!loaded.ok || JSON.stringify(loaded.recovery) !== JSON.stringify(candidate)) {
      storage.setItem(bulkReminderRecoveryStorageKey(candidate.eventId), JSON.stringify(candidate));
    }
    const verified = loadBulkReminderRecovery(storage, candidate.eventId);
    return verified.ok && JSON.stringify(verified.recovery) === JSON.stringify(candidate);
  } catch {
    return false;
  }
}

/** A confirmed result is complete only once its exact browser marker is gone. */
export function clearBulkReminderRecovery(
  storage: Pick<RecoveryStorage, "getItem" | "removeItem">,
  recovery: Pick<BulkReminderRecovery, "eventId" | "attemptId">,
): boolean {
  try {
    const loaded = loadBulkReminderRecovery(storage, recovery.eventId);
    if (!loaded.ok) return loaded.reason === "missing";
    if (loaded.recovery.attemptId !== recovery.attemptId) return false;
    storage.removeItem(bulkReminderRecoveryStorageKey(recovery.eventId));
    const after = loadBulkReminderRecovery(storage, recovery.eventId);
    return !after.ok && after.reason === "missing";
  } catch {
    return false;
  }
}

/** Deduplicate without reordering: server results retain the frozen row order. */
export function normalizeBulkReminderTargets(targets: readonly BulkReminderTarget[]): BulkReminderTarget[] {
  const seen = new Set<string>();
  const normalized: BulkReminderTarget[] = [];
  for (const value of targets) {
    const target = bulkReminderTargetSchema.parse(value);
    const key = `${target.taskId}:${target.contactId}:${target.submissionId ?? "-"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(target);
  }
  return normalized;
}

export function createBulkReminderRecovery(
  eventId: EventId,
  surface: BulkReminderSurface,
  targets: readonly BulkReminderTarget[],
  attemptId: string = crypto.randomUUID(),
): BulkReminderRecovery {
  return bulkReminderRecoverySchema.parse({
    version: RECOVERY_VERSION,
    eventId,
    surface,
    attemptId,
    targets: normalizeBulkReminderTargets(targets),
  });
}

export function withBulkReminderResolution(
  recovery: BulkReminderRecovery,
  resolution: BulkReminderResolution,
): BulkReminderRecovery {
  return bulkReminderRecoverySchema.parse({ ...recovery, resolution });
}

export function bulkReminderResultMessage(result: BulkReminderResult): { message: string; kind?: "error" } {
  const statuses = result.results.map((entry) => entry.attemptStatus ?? "not_open");
  const queued = statuses.filter((status) => status === "queued").length;
  const sent = statuses.filter((status) => status === "sent").length;
  const notOpen = statuses.filter((status) => status === "not_open").length;
  const attention = result.total - queued - sent - notOpen;
  const parts = [
    queued ? `${queued} queued` : "",
    sent ? `${sent} already sent` : "",
    notOpen ? `${notOpen} no longer open` : "",
    attention ? `${attention} need attention in Communications` : "",
  ].filter(Boolean);
  return {
    message: `Reminder status: ${parts.join(" · ")}`,
    ...(attention ? { kind: "error" as const } : {}),
  };
}
