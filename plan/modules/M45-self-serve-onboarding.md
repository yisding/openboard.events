# M45 — Self-serve onboarding

| | |
|---|---|
| **Status** | RETROACTIVE work order — **MERGED (rev. 12 / PR #95, merge `7b9cf3a`)**, with later production-readiness follow-ups. A 4-step guided wizard (`src/features/onboarding/components/onboarding-wizard.tsx`) at `/organizations/[id]/onboarding`: event basics → vocabulary/tracks → first CFP form (M12's default 12-field form, optional publish) → a shareable public link. The whole flow is one composition, `provisionOrganizationEventIn`, over M11's already-merged `createEventIn` and M43's `assignEventToOrganizationIn` — **zero new `INSERT` statements**, and it is additionally gated on M49's `assertOrganizationCanCreateEventIn` (the events-per-plan limit), so onboarding a new event for a `free`-plan organization already at its cap is blocked at this same call site rather than needing a second check later. No schema change. New `/organizations` and `/organizations/[id]` entry points close the seam M44's own status note documented ("`organizationHomeEventId` returns null until M45's event-creation flow lands"), and un-disables M11's "New event" button — the last step of event creation, not the first, exactly as the roadmap scoped it. Durable checkpoints now restore active and completed handoffs across reloads. `e2e/self-service-onboarding.spec.ts` drives the full public journey and reloads the exact completed event/form state; remaining before `DONE` is the first protected preview run with the read-capable Resend test credential. See [`../status.md`](../status.md) §2g. |
| **Workstream / executing agent** | Product/auth-chain lane, orchestrated run `wf_5ed21edd-4b0`. |
| **Scheduled** | P4 commercial layer, fourth module (hard-blocked on M43, M44). |
| **Size** | M |
| **Paths owned** | `src/features/onboarding/**`, `src/app/organizations/[organizationId]/onboarding/page.tsx`, `src/app/organizations/page.tsx`, `src/app/organizations/[organizationId]/page.tsx`, `src/app/organizations/[organizationId]/layout.tsx`. |

## Objective

Replace the manual provisioning runbook with a guided, self-serve event-creation flow: an
organization admin goes from "just signed up" to "has a published CFP form with a shareable link"
in one 4-step wizard, reusing every write path M11's event creation and M43's tenancy assignment
already proved, adding no new mutation of its own.

## Dependencies

- **Hard:** M43 (organization tenancy — events must be scoped to an organization from creation),
  M44 (user management — an onboarding admin needs to exist and be signed in), M11 (`createEventIn`,
  the only event-creation write path this module composes over), M49 (`assertOrganizationCanCreateEventIn`,
  the events-per-plan gate checked before any write).

## Provides (interfaces others consume)

```ts
// src/features/onboarding/index.ts
export { provisionOrganizationEvent, provisionOrganizationEventIn } from "./server/provisioning";
```

No downstream P4 module consumes this module's exports — like M41, it is a terminal leaf; this doc
still records the signature for M10-style e2e authorship.

## Contract and data additions

- None. `provisionOrganizationEventIn` is a pure composition over M11's `createEventIn` and M43's
  `assignEventToOrganizationIn` — no new table, column, or `src/shared/contracts/**` addition.

## Acceptance criteria

Proven (PGlite, code-complete):

1. `provisionOrganizationEventIn` creates the event scoped to the calling organization, not the
   default organization (`src/features/onboarding/server/provisioning.test.ts:77`).
2. It runs the full M11 create path underneath — owner membership and defaults are exactly what
   direct event creation produces (`:86`).
3. A second organization's onboarded events are scoped independently — no cross-tenant leakage
   (`:98`).
4. The M49 entitlement gate blocks a `free`-plan organization at its event cap and still increments
   the usage counter for every event that was allowed through before the block
   (`:121`).
5. `pnpm exec vitest run src/features/onboarding/server/provisioning.test.ts` is green (5/5).

Deployed evidence — **automated, protected run outstanding**:

6. Walk the full 4-step wizard (basics → vocabulary/tracks → default CFP form → shareable link) on
   the deployed preview as a freshly onboarded organization admin, then complete
   the generated CFP as a real OTP-authenticated speaker and see that proposal
   arrive back in the organizer dashboard. The spec also removes and re-adds a
   suggested track in step 2, proving that accidental setup choices are
   recoverable without leaving onboarding. Removal confirms its effects on
   existing submissions and routing rules and replays an ambiguous idempotent
   delete before the wizard can continue.
7. Confirm the resulting public CFP link is reachable, hides empty optional
   vocabulary controls, accepts a real submission, returns its SESS reference,
   and produces the organizer's first-submission dashboard handoff.
8. Confirm the un-disabled "New event" button on M11's events list correctly routes into this
   wizard rather than the old disabled state. The protected browser spec covers the first-event
   route and completed-handoff reload; its first preview run awaits `E2E_RESEND_API_KEY`.

## Guardrails

- This module performs **zero direct writes** to `events`, `organization_members`, or
  `organization_subscriptions`/`organization_usage_counters` — every write goes through M11's or
  M43's or M49's already-audited functions. If a future step seems to need a new `INSERT`, that is a
  signal the composition has drifted; the fix belongs in the module that owns that table, not here.
- The events-per-plan check runs *before* any write in the composition, not after — a blocked
  organization must never end up with a partially-created event.
- "Un-disabling the New event button is the last step, not the first" (roadmap wording, verbatim):
  this module does not change what `createEventIn` does, only what calls it.
