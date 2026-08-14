import type { JobStats } from "@/shared/contracts";

export const OUTBOX_MAX_BATCH_SIZE = 50;
export const OUTBOX_MAX_ATTEMPTS = 6;
export const OUTBOX_DELIVERY_CONCURRENCY = 5;

export type OutboxDeliveryOutcome = "sent" | "skipped";
export type OutboxFailureOutcome = "failed" | "retried";
export type OutboxDispatchStats = JobStats & {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  retried: number;
};

export type OutboxFailureTransition =
  | { outcome: "failed"; errorMessage: string }
  | { outcome: "retried"; errorMessage: string; retryDelayMinutes: number };

type OutboxRow = { attempts: number };

export function compareOutboxRows(
  left: { id: string; createdAt: Date },
  right: { id: string; createdAt: Date },
): number {
  const createdAtDifference = left.createdAt.getTime() - right.createdAt.getTime();
  if (createdAtDifference !== 0) return createdAtDifference;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

type DrainOutboxOptions<Row extends OutboxRow> = {
  requestedBudget: number;
  claim: (budget: number) => Promise<Row[]>;
  deliver: (row: Row) => Promise<OutboxDeliveryOutcome>;
  /** Rows in one lane remain ordered; independent lanes run concurrently. */
  deliveryKey: (row: Row) => string;
  isTerminalError: (row: Row, error: unknown) => boolean;
  transitionFailure: (row: Row, transition: OutboxFailureTransition) => Promise<void>;
  concurrency?: number;
};

export function outboxBudget(requestedBudget: number): number {
  return Number.isFinite(requestedBudget)
    ? Math.min(Math.max(Math.trunc(requestedBudget), 1), OUTBOX_MAX_BATCH_SIZE)
    : OUTBOX_MAX_BATCH_SIZE;
}

export function outboxErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

export function outboxRetryDelayMinutes(attempts: number): number {
  return Math.min(2 ** attempts, 60);
}

function failureTransition<Row extends OutboxRow>(
  row: Row,
  error: unknown,
  isTerminalError: DrainOutboxOptions<Row>["isTerminalError"],
): OutboxFailureTransition {
  const errorMessage = outboxErrorMessage(error);
  const terminal = row.attempts >= OUTBOX_MAX_ATTEMPTS
    || errorMessage.includes("email sending is not configured")
    || isTerminalError(row, error);
  return terminal
    ? { outcome: "failed", errorMessage }
    : { outcome: "retried", errorMessage, retryDelayMinutes: outboxRetryDelayMinutes(row.attempts) };
}

async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  requestedConcurrency: number,
  operation: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  if (items.length === 0) return [];
  const concurrency = Number.isFinite(requestedConcurrency)
    ? Math.min(Math.max(Math.trunc(requestedConcurrency), 1), items.length)
    : Math.min(OUTBOX_DELIVERY_CONCURRENCY, items.length);
  const results = new Array<Result>(items.length);
  const indexedItems = items.map((item, index) => ({ item, index }));
  let nextIndex = 0;
  let firstError: unknown;
  let failed = false;
  const worker = async () => {
    while (true) {
      const entry = indexedItems[nextIndex];
      if (!entry) return;
      nextIndex += 1;
      try {
        results[entry.index] = await operation(entry.item);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (failed) throw firstError;
  return results;
}

/**
 * Owns the lifecycle shared by every email outbox. Table-specific adapters
 * claim rows and persist transitions; feature adapters render and deliver.
 */
export async function drainOutbox<Row extends OutboxRow>(
  options: DrainOutboxOptions<Row>,
): Promise<OutboxDispatchStats> {
  const rows = await options.claim(outboxBudget(options.requestedBudget));
  const lanes = new Map<string, Row[]>();
  for (const row of rows) {
    const key = options.deliveryKey(row);
    const lane = lanes.get(key);
    if (lane) lane.push(row);
    else lanes.set(key, [row]);
  }
  const laneOutcomes = await mapWithConcurrency(
    [...lanes.values()],
    options.concurrency ?? OUTBOX_DELIVERY_CONCURRENCY,
    async (lane): Promise<Array<OutboxDeliveryOutcome | OutboxFailureOutcome>> => {
      const outcomes: Array<OutboxDeliveryOutcome | OutboxFailureOutcome> = [];
      for (const row of lane) {
        try {
          outcomes.push(await options.deliver(row));
        } catch (error) {
          const transition = failureTransition(row, error, options.isTerminalError);
          await options.transitionFailure(row, transition);
          outcomes.push(transition.outcome);
        }
      }
      return outcomes;
    },
  );
  const stats: OutboxDispatchStats = {
    claimed: rows.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    retried: 0,
  };
  for (const outcome of laneOutcomes.flat()) stats[outcome] += 1;
  return stats;
}
