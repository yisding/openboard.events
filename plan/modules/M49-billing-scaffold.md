# M49 — Billing scaffold

| | |
|---|---|
| **Status** | RETROACTIVE work order — **MERGED (rev. 12 / PR #95, merge `7b9cf3a`)**, no active claim. A hand-seeded plan catalog (`billing_plans`: free/pro/enterprise, `drizzle/0012_billing_scaffold.sql`), one `organization_subscriptions` row per organization — existing organizations backfilled (the seeded default organization pinned to `enterprise`, every other pre-existing organization to `free`), and `createOrganizationIn`'s atomic CTE now also seeds a `free` subscription row for every *newly* created organization, so no organization ever exists without a subscription row to check. `organization_usage_counters` tracks metered usage. The one real limit wired up is events-per-organization: `assertOrganizationCanCreateEventIn` runs a live `COUNT(events)` against the plan's `maxEvents` **before any write happens** inside M45's `provisionOrganizationEventIn`, and falls back to the free plan's limit (never an unlimited one) if a subscription row is somehow missing — fail-closed, not fail-open. A `BillingProviderAdapter` seam exists (`src/features/billing/server/provider.ts`) with exactly one implementation, `StubBillingProviderAdapter`: `startCheckout`/`startPortalSession` throw `VALIDATION` rather than fabricate a working URL — there is deliberately no fake-success path a UI could accidentally ship behind. Webhook verification (`POST /api/webhooks/billing`) is a real HMAC over the raw request body, fails closed when `BILLING_WEBHOOK_SECRET` is unset or no signature header is sent. Billing settings surface at `/organizations/[id]/billing`. Proven via `tests/integration/billing.test.ts` (10 cases) and `src/features/billing/server/provider.test.ts` (6 cases). Remaining before `DONE`: deployed/browser evidence — the billing settings page, the events-per-plan block surfaced in the onboarding wizard, and the webhook's fail-closed behavior have not been exercised against the deployed preview; `BILLING_WEBHOOK_SECRET` is unset there, so the deployed route currently 401s unconditionally, which is the correct fail-closed behavior but has not been explicitly confirmed deployed. See [`../status.md`](../status.md) §2g. |
| **Workstream / executing agent** | Product/auth-chain lane, orchestrated run `wf_5ed21edd-4b0`. |
| **Scheduled** | P4 commercial layer, last module in the auth chain (hard-blocked on M43, M44 by construction — "there is nowhere to attach a plan today" without an organization). |
| **Size** | M |
| **Paths owned** | `src/features/billing/**`, `src/features/billing/components/billing-panel.tsx`, `src/app/organizations/[organizationId]/billing/page.tsx`, `src/app/api/internal/organizations/[organizationId]/billing/**`, `src/app/api/webhooks/billing/route.ts`, `drizzle/0012_billing_scaffold.sql`, `tests/integration/billing.test.ts`, `src/features/billing/server/provider.test.ts`. |

## Objective

Hang plans, entitlements, and metering off `organizations` with a real, enforced limit (events per
plan) and a payment-provider seam that is honest about not having a live provider behind it yet —
so the product has a billing *shape* to build a real integration into later, without ever
pretending checkout works today.

## Dependencies

- **Hard:** M43 (organizations to attach subscriptions to — "blocked on M43 by construction"), M44
  (billing settings is an owner-only surface, reusing M44's role checks).
- **Downstream (gated on this module):** M45 (`provisionOrganizationEventIn` calls
  `assertOrganizationCanCreateEventIn` before writing).

## Provides (interfaces others consume)

```ts
// src/features/billing/index.ts
export { getOrganizationBillingSummary, getOrganizationBillingSummaryIn,
  getOrganizationSubscription, getOrganizationSubscriptionIn,
  getBillingPlan, getBillingPlanIn, listBillingPlans, listBillingPlansIn,
  listOrganizationUsageCounters, listOrganizationUsageCountersIn,
  countOrganizationEventsIn } from "./server/queries";
export { assertOrganizationCanCreateEvent, assertOrganizationCanCreateEventIn,
  getOrganizationPlan, getOrganizationPlanIn } from "./server/entitlements";
export { incrementOrganizationUsage, incrementOrganizationUsageIn } from "./server/usage";
export { getBillingProviderAdapter, StubBillingProviderAdapter,
  applyBillingProviderEvent, applyBillingProviderEventIn,
  type BillingProviderAdapter, type BillingCheckoutInput,
  type BillingPortalInput, type BillingProviderWebhookEvent } from "./server/provider";
```

## Contract and data additions

- `drizzle/0012_billing_scaffold.sql` (additive): `billing_plans` (hand-seeded catalog),
  `organization_subscriptions` (one row per organization, backfilled for every pre-existing
  organization), `organization_usage_counters`.
- `src/shared/contracts/billing.ts` (new file, in-scope for this module): plan/subscription/
  webhook-event DTOs and the `startBillingCheckoutInputSchema` the checkout route validates against.
- `BILLING_WEBHOOK_SECRET` env var (optional; its absence is a fail-closed condition, not a
  disabled-feature condition).

## Acceptance criteria

Proven (PGlite, code-complete):

1. The plan catalog seeds correctly; a brand-new organization gets a `free` subscription atomically
   with its creation; the seeded default organization is pinned to `enterprise` via the backfill
   (`tests/integration/billing.test.ts:65,74,80`).
2. `assertOrganizationCanCreateEventIn` allows creation under the free plan's cap and blocks exactly
   at it; a plan with `maxEvents: null` is never blocked; a missing subscription row falls back to
   the free plan's limit, never an unlimited one (`billing.test.ts:87,96,103`).
3. The billing summary is computed from the live plan, live event count, and live counters — not a
   cached/denormalized value (`billing.test.ts:112`).
4. A verified webhook event is applied to the organization's subscription, including a
   `subscription.canceled` event marking `cancelAtPeriodEnd`; an event for an organization with no
   subscription row is rejected (`billing.test.ts:128,143,151`).
5. `StubBillingProviderAdapter` never fabricates a working checkout or billing-portal session — both
   throw `VALIDATION` (`src/features/billing/server/provider.test.ts:22`).
6. Webhook signature verification accepts a correctly signed request, rejects a tampered body or the
   wrong secret's signature, and fails closed with no signature header and with no secret configured
   at all (`provider.test.ts:35,41,49`).
7. `parseWebhookEvent` parses a well-formed event and returns `null` (never throws) for malformed
   JSON or a payload missing required fields (`provider.test.ts:57,68`).
8. `pnpm exec vitest run tests/integration/billing.test.ts src/features/billing/server/provider.test.ts`
   is green (16/16) — 10 + 6, matching the AC line-citations above.

Deployed evidence — **outstanding**:

9. `/organizations/[id]/billing` rendered and interacted with in a browser against the deployed
   preview, including the read-only plan/usage summary.
10. The events-per-plan block surfaced live in M45's onboarding wizard when a `free`-plan
    organization is at its cap.
11. `POST /api/webhooks/billing` confirmed 401 on the deployed preview today (no
    `BILLING_WEBHOOK_SECRET` provisioned there) — the fail-closed behavior is implied by AC 6 but
    has not been explicitly checked against the live route. No `e2e/**` spec covers any of this.

## Guardrails

- The one enforced limit (events-per-organization) runs its `COUNT` check **before** any write in
  `provisionOrganizationEventIn` — a blocked organization must never end up with a partially-created
  event.
- `StubBillingProviderAdapter` must never grow a code path that returns a real-looking checkout URL;
  a live provider is a distinct adapter implementation behind the same interface, not a flag on this
  one.
- Webhook verification fails closed on every ambiguous case (no secret configured, no signature
  header, tampered body) — never fails open "for convenience" in any environment.
- Billing settings access reuses M44's owner/admin role checks; this module does not introduce a
  parallel authorization path for who can view or change billing.
