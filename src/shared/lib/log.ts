export type LogEntry = {
  level: "debug" | "info" | "warn" | "error";
  msg: string;
  requestId: string;
  feature: string;
  code?: string;
  eventId?: string;
  durationMs?: number;
};

export function log(entry: LogEntry): void {
  console.log(JSON.stringify(entry));
}
