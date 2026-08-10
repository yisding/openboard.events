import { sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { type EventId } from "@/shared/contracts";
import { domainDeliverabilityRowSchema, type DomainDeliverabilityRow } from "../schemas";

/**
 * Mirrors `getLogDetailIn`'s tolerance for the two shapes a raw `execute()`
 * can return (PGlite's array vs. neon-http's `{ rows }`) — see that
 * function's own copy in `admin-mutations.ts` for why this stays a small,
 * duplicated helper rather than a shared export: neither module wants to
 * import the other just for six lines.
 */
function rowsOf<Row>(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows: unknown }).rows)) {
    return (result as { rows: Row[] }).rows;
  }
  return [];
}

type DomainCountRow = {
  domain: string;
  total: string | number;
  queued: string | number;
  sent: string | number;
  failed: string | number;
  skipped: string | number;
  bounced: string | number;
  complained: string | number;
};

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * M46 — per-domain deliverability visibility, aggregated straight off
 * `communication_logs` (no new table: the roadmap names this an aggregate
 * *view* of data the dispatcher and the Resend webhook already write).
 * Grouped by the recipient's email domain, lower-cased so `Example.com` and
 * `example.com` are one row. Ordered by volume — the domains an organizer
 * actually needs to watch (Gmail, the corporate domain half their speakers
 * use) sort to the top without a separate "sort by" control.
 *
 * The two rate fields are computed here, in TypeScript, rather than in SQL:
 * PGlite and neon-http agree on plain aggregate counts but a division that
 * needs to guard a zero denominator is one fewer thing to get subtly wrong
 * across the two engines this query is tested and run against.
 */
export async function getDeliverabilityByDomainIn(dbOrTx: DbOrTx, eventId: EventId): Promise<DomainDeliverabilityRow[]> {
  const result = await dbOrTx.execute(sql`
    SELECT
      lower(split_part(c.email, '@', 2)) AS domain,
      count(*) AS total,
      count(*) FILTER (WHERE l.status = 'queued') AS queued,
      count(*) FILTER (WHERE l.status = 'sent') AS sent,
      count(*) FILTER (WHERE l.status = 'failed') AS failed,
      count(*) FILTER (WHERE l.status = 'skipped') AS skipped,
      count(*) FILTER (WHERE l.status = 'bounced') AS bounced,
      count(*) FILTER (WHERE l.status = 'complained') AS complained
    FROM communication_logs l
    JOIN contacts c ON c.id = l.contact_id AND c.event_id = l.event_id
    WHERE l.event_id = ${eventId}
    GROUP BY domain
    ORDER BY count(*) DESC, domain ASC
  `);
  return rowsOf<DomainCountRow>(result).map((row) => {
    const sent = Number(row.sent);
    const bounced = Number(row.bounced);
    const complained = Number(row.complained);
    const settled = sent + bounced + complained;
    return domainDeliverabilityRowSchema.parse({
      domain: row.domain,
      total: Number(row.total),
      queued: Number(row.queued),
      sent,
      failed: Number(row.failed),
      skipped: Number(row.skipped),
      bounced,
      complained,
      bounceRatePct: pct(bounced, settled),
      complaintRatePct: pct(complained, settled),
    });
  });
}

export function getDeliverabilityByDomain(eventId: EventId): Promise<DomainDeliverabilityRow[]> {
  return getDeliverabilityByDomainIn(db, eventId);
}
