const LEGACY_PRESIGN_GRACE_MS = 15 * 60 * 1000;

export type MigrationState = {
  complete: boolean;
  remaining_legacy_rows: number;
  remaining_legacy_objects: number;
  failures: number;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
};

function counter(value: unknown, name: string): number {
  if (value === null || value === undefined || value === "") {
    throw new Error(`R2 staging migration returned an invalid ${name}`);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`R2 staging migration returned an invalid ${name}`);
  }
  return parsed;
}

function timestamp(value: unknown, name: string): string {
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw new Error(`R2 staging migration returned an invalid ${name}`);
  }
  const serialized = value instanceof Date ? value.toISOString() : value;
  if (!Number.isFinite(Date.parse(serialized))) {
    throw new Error(`R2 staging migration returned an invalid ${name}`);
  }
  return serialized;
}

export function parseMigrationState(row: Record<string, unknown>): MigrationState {
  if (typeof row.complete !== "boolean") {
    throw new Error("R2 staging migration returned an invalid complete flag");
  }
  return {
    complete: row.complete,
    remaining_legacy_rows: counter(row.remaining_legacy_rows, "remaining row count"),
    remaining_legacy_objects: counter(row.remaining_legacy_objects, "remaining object count"),
    failures: counter(row.failures, "failure count"),
    started_at: timestamp(row.started_at, "start timestamp"),
    updated_at: timestamp(row.updated_at, "update timestamp"),
    completed_at: row.completed_at === null ? null : timestamp(row.completed_at, "completion timestamp"),
  };
}

export function migrationStateIsVerified(state: MigrationState): boolean {
  const coveredPresignWindow = state.completed_at
    ? Date.parse(state.completed_at) - Date.parse(state.started_at) >= LEGACY_PRESIGN_GRACE_MS
    : false;
  return state.complete
    && coveredPresignWindow
    && state.remaining_legacy_rows === 0
    && state.remaining_legacy_objects === 0
    && state.failures === 0;
}
