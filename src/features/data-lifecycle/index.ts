/**
 * M47 — data lifecycle & GDPR.
 *
 * Cuts across `contacts`/`organizations`/`comms` rather than owning a schema
 * of its own: contact/organization export are read compositions over
 * existing feature queries, right-to-erasure is the one new writer this
 * module introduces (the 9th audited `withTx` function — see the comment on
 * `withTx` in `src/db/client.ts`), and retention is a set of independent
 * statements wired into the existing cleanup cron the same way M08/P3-OPS's
 * R2 orphan sweep already is.
 */
export { exportContactData, exportContactDataIn, type ContactDataExport } from "./server/contact-export";
export { exportOrganizationData, exportOrganizationDataIn, type OrganizationDataExport } from "./server/organization-export";
export { eraseContactData, eraseContactDataIn } from "./server/contact-erasure";
export { runDataRetentionSweep, runDataRetentionSweepIn, type DataRetentionStats } from "./server/retention";
