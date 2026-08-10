import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { organizationContactActivity, organizationContacts } from "@/db/schema";
import { parseCsv } from "@/features/portal/server/speaker-csv";
import {
  CRM_CSV_FIELDS,
  crmCsvRowOutcomeSchema,
  importCrmContactsCsvResultSchema,
  organizationContactIdSchema,
  type CrmCsvField,
  type CrmCsvRowOutcome,
  type ImportCrmContactsCsvInput,
  type ImportCrmContactsCsvResult,
  type OrganizationId,
} from "@/shared/contracts";

/**
 * M55 — organization-aware CSV import with preview/errors and duplicate
 * detection (work order scope). Parsing reuses M51's `parseCsv`
 * (`src/features/portal/server/speaker-csv.ts`) unchanged — RFC-4180-ish,
 * already tested — rather than a second CSV reader; only the column list
 * and the destination table differ.
 *
 * Duplicate detection is against `organization_contacts.email` within this
 * organization (not per-event, the roster importer's scope one level down):
 * a row whose email already exists here is `matched_existing` and, on
 * commit, fills only the blank fields the existing row has — never
 * overwrites a non-empty value, the same "CSV import never silently
 * overwrites" policy M51's roster import documents. A second occurrence of
 * the same email *within this file* is `duplicate_in_file` and is never
 * written, so retrying a commit is safe (the first occurrence's write
 * already happened; the duplicate row was always skipped).
 */

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

type CrmCsvRow = { rowNumber: number; email: string | null; values: Partial<Record<CrmCsvField, string>>; error: string | null };

function readCrmCsvRows(rows: string[][], mapping: ImportCrmContactsCsvInput["mapping"]): CrmCsvRow[] {
  const [, ...dataRows] = rows;
  return dataRows.map((cells, index): CrmCsvRow => {
    const rowNumber = index + 2;
    const rawEmail = cells[mapping.email]?.trim() ?? "";
    if (!rawEmail) return { rowNumber, email: null, values: {}, error: "Missing email" };
    const parsed = emailSchema.safeParse(rawEmail);
    if (!parsed.success) return { rowNumber, email: null, values: {}, error: `Invalid email "${rawEmail}"` };
    const values: Partial<Record<CrmCsvField, string>> = {};
    for (const field of CRM_CSV_FIELDS) {
      const columnIndex = mapping.fields[field];
      if (columnIndex === undefined) continue;
      const raw = cells[columnIndex]?.trim() ?? "";
      if (raw) values[field] = raw;
    }
    return { rowNumber, email: parsed.data, values, error: null };
  });
}

export async function importCrmContactsCsvIn(dbOrTx: DbOrTx, organizationId: OrganizationId, input: ImportCrmContactsCsvInput): Promise<ImportCrmContactsCsvResult> {
  const parsed = readCrmCsvRows(parseCsv(input.csvText), input.mapping);
  const seenInFile = new Set<string>();
  const outcomes: CrmCsvRowOutcome[] = [];
  let created = 0;
  let matchedExisting = 0;
  let errors = 0;

  for (const row of parsed) {
    if (row.error || !row.email) {
      errors += 1;
      outcomes.push(crmCsvRowOutcomeSchema.parse({ rowNumber: row.rowNumber, email: row.email, status: "error", error: row.error ?? "Invalid row", organizationContactId: null }));
      continue;
    }
    if (seenInFile.has(row.email)) {
      outcomes.push(crmCsvRowOutcomeSchema.parse({ rowNumber: row.rowNumber, email: row.email, status: "duplicate_in_file", error: null, organizationContactId: null }));
      continue;
    }
    seenInFile.add(row.email);

    const [existing] = await dbOrTx.select().from(organizationContacts)
      .where(and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.email, row.email))).limit(1);

    if (existing) {
      matchedExisting += 1;
      const organizationContactId: string | null = existing.id;
      if (input.mode === "commit") {
        const fill: Partial<typeof organizationContacts.$inferInsert> = {};
        if (!existing.firstName && row.values.firstName) fill.firstName = row.values.firstName;
        if (!existing.lastName && row.values.lastName) fill.lastName = row.values.lastName;
        if (!existing.company && row.values.company) fill.company = row.values.company;
        if (!existing.jobTitle && row.values.jobTitle) fill.jobTitle = row.values.jobTitle;
        if (!existing.linkedinUrl && row.values.linkedinUrl) fill.linkedinUrl = row.values.linkedinUrl;
        if (!existing.twitterUrl && row.values.twitterUrl) fill.twitterUrl = row.values.twitterUrl;
        if (!existing.websiteUrl && row.values.websiteUrl) fill.websiteUrl = row.values.websiteUrl;
        if (Object.keys(fill).length > 0) {
          await dbOrTx.update(organizationContacts).set({ ...fill, updatedAt: new Date() }).where(eq(organizationContacts.id, existing.id));
          await dbOrTx.insert(organizationContactActivity).values({ organizationId, organizationContactId: existing.id, kind: "imported", metadata: { rowNumber: row.rowNumber, filled: Object.keys(fill) } });
        }
      }
      outcomes.push(crmCsvRowOutcomeSchema.parse({ rowNumber: row.rowNumber, email: row.email, status: "matched_existing", error: null, organizationContactId }));
      continue;
    }

    created += 1;
    if (input.mode === "preview") {
      outcomes.push(crmCsvRowOutcomeSchema.parse({ rowNumber: row.rowNumber, email: row.email, status: "created", error: null, organizationContactId: null }));
      continue;
    }
    const [inserted] = await dbOrTx.insert(organizationContacts).values({
      organizationId, email: row.email,
      firstName: row.values.firstName ?? "", lastName: row.values.lastName ?? "",
      company: row.values.company ?? null, jobTitle: row.values.jobTitle ?? null,
      linkedinUrl: row.values.linkedinUrl ?? null, twitterUrl: row.values.twitterUrl ?? null, websiteUrl: row.values.websiteUrl ?? null,
      source: "import",
    }).onConflictDoNothing({ target: [organizationContacts.organizationId, organizationContacts.email] }).returning();
    const organizationContactId = inserted ? organizationContactIdSchema.parse(inserted.id) : null;
    if (organizationContactId) await dbOrTx.insert(organizationContactActivity).values({ organizationId, organizationContactId, kind: "imported", metadata: { rowNumber: row.rowNumber } });
    outcomes.push(crmCsvRowOutcomeSchema.parse({ rowNumber: row.rowNumber, email: row.email, status: "created", error: null, organizationContactId }));
  }

  return importCrmContactsCsvResultSchema.parse({ rows: outcomes, created, matchedExisting, errors });
}
export const importCrmContactsCsv = (organizationId: OrganizationId, input: ImportCrmContactsCsvInput): Promise<ImportCrmContactsCsvResult> =>
  importCrmContactsCsvIn(db, organizationId, input);
