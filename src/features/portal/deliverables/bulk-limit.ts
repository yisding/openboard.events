/**
 * The Files table/export bound. Reminder sends use the smaller
 * `BULK_REMINDER_TARGET_LIMIT`: unlike one export job insert, each reminder
 * target intentionally retains an independent commit boundary.
 */
export const DELIVERABLE_BULK_LIMIT = 200;
