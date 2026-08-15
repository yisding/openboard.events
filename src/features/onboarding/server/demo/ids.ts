import { stableUuid } from "@/shared/server/stable-uuid";
import { RESERVED_SLUGS } from "@/shared/lib/slug";
import type { EventId, OrganizationId } from "@/shared/contracts";

/**
 * Identity namespacing for the "First Fair" demo world (design §2.2, D5).
 *
 * `scripts/seed`'s `seedId(kind, key)` is a uuidv5 over a single fixed global
 * namespace with no tenant component: fine for the one standing sandbox
 * database, fatal for a runtime demo that a second organization can also
 * provision, because every child row's primary key would collide across
 * tenants. This module is the fix: every id here is derived from
 * `stableUuid`, chained namespace-under-namespace —
 *
 *   organizationId -> demoEventId -> demoId(eventId, key)
 *
 * — so two organizations' demo worlds share no primary key anywhere, a
 * double-clicked "Explore" button is a replay rather than a second
 * conference (the same organization always resolves to the same event id),
 * and every other global-unique surface (`events.slug`,
 * `communication_logs.idempotency_key`) gets a deterministic, event-scoped
 * value instead of a literal that only works once. `seedId` itself is
 * untouched: this module never calls it and never reuses its namespace.
 */

/**
 * Bumping this mints an entirely new event-id namespace for every
 * organization's demo — the only supported way to change the dataset's
 * *shape* (row counts, ids) without colliding with a previously-provisioned
 * demo. A content-only edit (new bio copy, a retitled session) does not need
 * a bump; changing which rows exist, or how many, does.
 */
export const DEMO_DATASET_VERSION = 1;

/**
 * The organization's one demo event. Deterministic on purpose: re-running
 * provisioning (a double-clicked button, a retried request, an explicit
 * "reset") always resolves to the same event id, so "provision" and
 * "replay" are the same code path rather than two.
 */
export function demoEventId(organizationId: OrganizationId): EventId {
  return stableUuid(organizationId, `demo-event:v${DEMO_DATASET_VERSION}`) as EventId;
}

/**
 * Every child row of the demo event — contacts, forms, submissions,
 * sessions, everything. The event id is the namespace, so the same `key`
 * ("speaker:dana-whitfield", "session:opening-keynote", …) produces a
 * different, unrelated uuid for every organization's demo, and the same uuid
 * every time the same organization's demo is (re)provisioned.
 */
export function demoId(eventId: EventId, key: string): string {
  return stableUuid(eventId, `demo:${key}`);
}

/**
 * `events.slug` is globally UNIQUE, so a fixed literal collides the moment a
 * second organization provisions its own demo. The 8-hex suffix (taken from
 * the event id, which is already unique per organization) keeps the slug
 * readable and guarantees it never collides — and it is checked against
 * `RESERVED_SLUGS` at module load, not just at runtime, so a future edit to
 * either list fails loudly in tests instead of shipping a slug `/e/api/...`
 * would shadow a real route.
 */
export function demoSlug(eventId: EventId): string {
  const suffix = eventId.replace(/-/g, "").slice(0, 8);
  return `ai-engineer-worlds-fair-demo-${suffix}`;
}

const DEMO_SLUG_PREFIX = "ai-engineer-worlds-fair-demo-";
if ((RESERVED_SLUGS as readonly string[]).some((reserved) => DEMO_SLUG_PREFIX.startsWith(reserved))) {
  throw new Error(`demoSlug's fixed prefix "${DEMO_SLUG_PREFIX}" collides with a reserved slug`);
}

/**
 * Every fabricated contact's address, built in exactly one place. `.invalid`
 * is reserved by RFC 2606 for addresses that must never resolve — the
 * physical half of the two-rail email guard (D7): even if the software-side
 * `SkipEmail` guard were ever bypassed, there is still no mailbox on the
 * other end. `localPart` and `companySlug` are both lowercased and stripped
 * of anything that is not a letter, digit or dot, so a persona's name or
 * fictional company can never accidentally smuggle a second `@` into the
 * address.
 */
export function demoEmail(localPart: string, companySlug: string): string {
  const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9.]+/g, "");
  return `${clean(localPart)}@${clean(companySlug)}.demo.invalid`;
}
