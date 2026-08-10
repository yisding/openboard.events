import { z } from "zod";
import { contactIdSchema, eventIdSchema } from "./ids";

/**
 * M47 — data lifecycle & GDPR.
 *
 * The receipt returned by right-to-erasure: a per-table row count so a
 * deletion has a durable, auditable record of what was actually removed —
 * without a new database table to hold it. The API response and the
 * `gdpr.contact_erased` log line (`features/data-lifecycle`) together are
 * the record, the same "the request log is the audit trail" trade
 * `recordOrganizationAuditEventIn`'s own doc comment already makes for
 * membership actions.
 *
 * `deletedCounts` is a record rather than a fixed set of fields on purpose:
 * the erasure function owns which tables it touches, and a new one landing
 * later should not require a contract change to show up in the receipt.
 */
export const contactErasureReceiptSchema = z.object({
  eventId: eventIdSchema,
  contactId: contactIdSchema,
  erasedAt: z.iso.datetime(),
  deletedCounts: z.record(z.string(), z.int().nonnegative()),
});
export type ContactErasureReceipt = z.infer<typeof contactErasureReceiptSchema>;
