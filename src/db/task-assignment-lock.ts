import { sql } from "drizzle-orm";
import type { EventId, TaskId } from "@/shared/contracts";
import type { TxDb } from "./client";

/**
 * `task_assignments_v` is a derived view, so PostgreSQL cannot lock one of its
 * rows. Its task row is the stable mutex shared by reminder decisions and all
 * task-completion writers. The lock is intentionally task-wide: it is a little
 * coarser than an assignment lock, but it makes the fresh view read that
 * follows linearizable without adding another persistence object.
 */
export async function lockTaskAssignmentsIn(tx: TxDb, eventId: EventId, taskId: TaskId): Promise<void> {
  await tx.execute(sql`
    SELECT id FROM portal_tasks
    WHERE id = ${taskId} AND event_id = ${eventId}
    FOR UPDATE
  `);
}
