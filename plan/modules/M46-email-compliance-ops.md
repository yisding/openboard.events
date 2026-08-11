# M46 — Email compliance & deliverability ops

| | |
|---|---|
| **Status** | RETROACTIVE work order — **MERGED (rev. 11 / PR #94, merge `c662345`)**, no active claim — shipped a full P4 cycle before the M42 auth-chain hold was lifted, since it depends only on P2/P3-EMAIL's bounce/complaint plumbing, not on organization tenancy. Productizes P3-EMAIL's `contact_suppressions` table and bounce/complaint webhook with an admin surface: a suppression list with reinstate (`src/features/comms/components/suppressions-tab.tsx`, `server/suppression.ts`), per-domain deliverability (grouped bounce/complaint/sent rates over settled sends, excluding queued — `deliverability-tab.tsx`, `server/deliverability.ts`), a bulk segmented send workflow with a resolve-then-preview step (`bulk-send-tab.tsx`, `POST .../bulk-email/segment` resolving a `SpeakerSegmentFilter` into the `contactIds` M51's unchanged `POST .../bulk-email` route already accepts, plus `chunkContactIds` splitting any resolved segment above the 200-recipient compose cap into batches and `mergeBulkSendResults` folding their outcomes back into one summary), and a dedicated `UNSUBSCRIBE_SECRET` env var so unsubscribe tokens stop being signed with `SESSION_SECRET` (`src/features/comms/server/unsubscribe.ts`, optional-but-hygiene-checked in `src/shared/lib/env.ts`). No schema change — reads/writes P3-EMAIL's existing tables. Proven via `src/features/comms/{deliverability,suppression-admin}.test.ts` and `src/features/comms/hooks/use-bulk-send.test.ts` (15 cases total: 5 + 4 + 6). Remaining before `DONE`: deployed/browser evidence — the suppression list, deliverability tab, and bulk-send preview/send flow have not been driven in a browser against the deployed preview; a real bounce/complaint event has not been round-tripped through the deployed webhook into a visible suppression row on this admin surface. See [`../status.md`](../status.md) §2f. |
| **Workstream / executing agent** | P3/P5 compliance lane, orchestrated run `wf_5ed21edd-4b0` (rev. 11). |
| **Scheduled** | Alongside P3 (cheap, does not require the P4 auth chain). |
| **Size** | M |
| **Paths owned** | `src/features/comms/components/{suppressions-tab,deliverability-tab,bulk-send-tab}.tsx`, `src/features/comms/hooks/{use-suppressions,use-deliverability,use-bulk-send}.ts`, `src/features/comms/server/{suppression,deliverability}.ts`, the dedicated-secret slice of `src/features/comms/server/unsubscribe.ts`, `src/app/api/internal/comms/[eventId]/{suppressions,deliverability,bulk-email/segment}/**`. |

## Objective

Turn P3-EMAIL's bounce/complaint webhook and suppression table into something an organizer can
actually operate: see who is suppressed and reinstate them, see per-domain sending health, send a
segmented bulk message with a resolve-and-preview step instead of guessing recipient counts, and
stop reusing the session-signing secret for unsubscribe tokens.

## Dependencies

- **Hard:** P2's deployed email proof; P3-EMAIL's `contact_suppressions` table and bounce/complaint
  webhook (already merged before this module).
- **Soft:** M51's `POST .../bulk-email` route (this module's segment-resolve step feeds it
  unchanged `contactIds`; it does not fork a second send path).

## Provides (interfaces others consume)

```ts
// src/features/comms/index.ts (this module's slice)
export { listSuppressions, listSuppressionsIn, removeSuppression, removeSuppressionIn,
  recordSuppression, recordSuppressionIn } from "./server/suppression";
export { getDeliverabilityByDomain, getDeliverabilityByDomainIn } from "./server/deliverability";
// client-side, reused by bulk-send-tab.tsx
export { chunkContactIds, mergeBulkSendResults } from "./hooks/use-bulk-send";
```

## Contract and data additions

- None. `UNSUBSCRIBE_SECRET` is a new optional env var (`src/shared/lib/env.ts`), not a schema or
  `src/shared/contracts/**` change; when unset, unsubscribe token signing falls back to the
  documented pre-existing behavior.

## Acceptance criteria

Proven (PGlite, code-complete):

1. The suppression list shows only the current event's suppressed contacts, newest first, with the
   recipient joined out, and never leaks another event's rows (`src/features/comms/suppression-admin.test.ts:45,53`).
2. Reinstating a suppressed contact removes it from the list; a second reinstate is a no-op; a
   contact suppressed under a different event cannot be reinstated here (`suppression-admin.test.ts:59,67`).
3. Per-domain deliverability groups by recipient email domain and sums every status, scoped to the
   event; rates are computed against settled sends (sent + bounced + complained), excluding queued;
   results are ordered by volume and never cross events (`src/features/comms/deliverability.test.ts:63,72,83,90,94`).
4. A resolved segment at or under the 200-recipient compose cap yields one batch; a segment above it
   splits into compose-sized batches (proven up to `resolveSpeakerSegmentIn`'s own 2,000-recipient
   ceiling, splitting into ten); an empty segment yields no batches; batch results merge in batch
   order with summed queued/skipped and concatenated errors (`src/features/comms/hooks/use-bulk-send.test.ts:8,13,22,29,35,51`).
5. `pnpm exec vitest run src/features/comms/deliverability.test.ts src/features/comms/suppression-admin.test.ts src/features/comms/hooks/use-bulk-send.test.ts`
   is green (15/15) — 5 + 4 + 6, matching the AC line-citations above.

Deployed evidence — **outstanding**:

6. Drive the suppression list, reinstate action, deliverability tab, and bulk-send resolve→preview→
   send flow in a browser against the deployed preview.
7. Round-trip a real bounce or complaint event through the deployed Resend webhook and confirm it
   produces a visible, reinstatable row on this admin surface (not just a `contact_suppressions`
   write proven at the DB layer).
8. Confirm a deployed unsubscribe link is signed with `UNSUBSCRIBE_SECRET` (not `SESSION_SECRET`)
   once that secret is provisioned as a worker var — currently absent from `sb-web-preview`'s vars,
   so the fallback path is what is actually live there today. No `e2e/**` spec covers any of this.

## Guardrails

- All bulk-segmented sends still go through M51's single `enqueueEmail`-backed send route; this
  module only adds a resolve/preview step and client-side batching in front of it — no second
  sender.
- Suppression/deliverability reads are always scoped by `eventId` in the query itself, never
  filtered client-side from an unscoped fetch.
- `UNSUBSCRIBE_SECRET` is optional but held to the same length/hygiene floor `SESSION_SECRET` is
  when set (`src/shared/lib/env.test.ts`); it must never silently accept a weak value.
