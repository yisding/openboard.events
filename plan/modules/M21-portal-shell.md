# M21 — Portal shell, home, submissions view

| | |
|---|---|
| **Status** | IN PROGRESS — the merged fixture-backed **STACK-DEMO** portal shell/home/submissions surface lacks portal auth/session, contact helpers, server queries, and AC. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-D agent (`features/portal`, folder-owner per PLAN.md §6). This is the first `features/portal`-lane module; the same agent spent Saturday on M07 + M05b (cross-folder grants) before starting here. |
| **Scheduled** | Sat PM – Sun, per WS-D's order (`M07 + M05b (Sat) → M21 (Sat PM–Sun)`). Starts once M06b's portal session (`requirePortal`, Sat PM) and M05a's core UI primitives (Sat AM) are available. |
| **Size** | M |
| **Paths owned** | `src/features/portal/index.ts`, `src/features/portal/index.client.ts` (barrel — created here; later portal modules append their own export lines, additive only); **`src/features/portal/server/contacts.ts`** (the resolution-#13 contact-write helpers — see Step 0; [M01](./M01-scaffold-ci-deploy.md)'s grep #7 names this file as the sole allowed writer of `contacts`, and [M06b](./M06b-portal-auth.md)/[M16](./M16-submit-pipeline.md)/[M18](./M18-submission-mutations-notify.md)/[M22](./M22-speaker-profile.md)/[M25](./M25-task-runtime.md)/[M27](./M27-speakers-admin.md) all depend on it); **`scripts/seed/portal.ts`** (WS-D's seed module per [M09](./M09-seed-demo-script.md) §3 — ship it **Sat PM**); `src/features/portal/server/queries.ts`, `src/features/portal/server/guards.ts`; `src/features/portal/components/shell/**`, `src/features/portal/components/home/**`, `src/features/portal/components/submissions-view/**`; `src/features/portal/hooks/**`; `src/features/portal/store.ts`; `src/app/(portal)/portal/[eventSlug]/layout.tsx`, `src/app/(portal)/portal/[eventSlug]/page.tsx`, `src/app/(portal)/portal/[eventSlug]/submissions/page.tsx`, `src/app/(portal)/portal/[eventSlug]/submissions/[submissionId]/page.tsx`; `src/app/api/internal/portal/submissions/route.ts`, `src/app/api/internal/portal/submissions/[id]/route.ts` |

## Objective

The authenticated speaker portal shell: nav, Home dashboard (My Submissions / My Profile / Tasks / My Sessions widgets), and a read-only submissions list + detail view. When done, a speaker who completes OTP login (M06b) lands on a Home page showing their own data only, with every widget's empty state designed (proven by the seeded empty second event), and can browse to a read-only submission detail. This is the page every later portal module (M22–M25, M41) mounts inside.

## Dependencies

- **Hard (blocks start):** [./M05a-admin-shell-ui.md](./M05a-admin-shell-ui.md)'s core UI primitives (`DataTable`, `StatusBadge`, `EmptyState`, `Dash`, `TzTime` — Sat AM). [./M06b-portal-auth.md](./M06b-portal-auth.md)'s `requirePortal(eventSlug)` guard + portal session cookie shape (Sat PM) — build against M06b's Phase-0 stub signature until the real cookie lands, swap import only.
- **Soft (start against stub/fixture):** [./M28-sessions-crud.md](./M28-sessions-crud.md)'s my-sessions query (dashed edge, agenda barrel) — code the "My Sessions" widget against a local typed fixture matching the frozen signature **`getMySessions(eventId, contactId): Promise<MySessionDTO[]>`** where `MySessionDTO = {sessionId, title, startsAt, endsAt, roomName, trackName}` ([M02](./M02-shared-contracts.md) `contracts/session.ts`; **not** `listMySessions`, **not** `ScheduledSessionDTO[]`); swap to the real `@/features/agenda` barrel import when M28 finishes (Sun AM). [./M18-submission-mutations-notify.md](./M18-submission-mutations-notify.md)'s `toPortalStatus` — pure and shipped in M18's first 30-minute slice, so it is importable immediately; **import it, never re-implement it** (Step 3).

## Provides (interfaces others consume)

```ts
// src/features/portal/server/contacts.ts, re-exported from src/features/portal/index.ts — SHIP FIRST (Step 0)
export async function getOrCreateContact(tx: TxDb, eventId: EventId, email: string): Promise<ContactId>;   // res. #13
export async function updateContactFields(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId,
                                          partial: Partial<ContactWritableFields>): Promise<void>;          // res. #13

// src/features/portal/index.ts
export async function listMySubmissions(eventId: EventId, contactId: string): Promise<PortalSubmissionRow[]>;
export async function getMySubmission(eventId: EventId, contactId: string, submissionId: string): Promise<PortalSubmissionDetail | null>;
export async function requirePortalContext(eventSlug: string): Promise<{ event: EventDTO; contact: ContactDTO; impersonatedBy?: string }>;
// NO status-mapping export here — the portal status chip comes from M18's `toPortalStatus`, imported
// from `@/features/submissions`. One mapping of the 7-state enum, one owner (resolution #8's discipline).
```

- `requirePortalContext` (wraps M06b's `requirePortal` + resolves the event row once) consumed by every subsequent portal page: [./M22-speaker-profile.md](./M22-speaker-profile.md) (profile), [./M25-task-runtime.md](./M25-task-runtime.md) (tasks runtime), [./M41-speaker-edit-until-close.md](./M41-speaker-edit-until-close.md) (edit page). M23's admin pages do **not** use this (admin auth, not portal auth).
- `getOrCreateContact`/`updateContactFields` consumed by **[./M06b-portal-auth.md](./M06b-portal-auth.md) (Sat PM), [./M16-submit-pipeline.md](./M16-submit-pipeline.md), [./M18-submission-mutations-notify.md](./M18-submission-mutations-notify.md) (Sat PM), [./M22-speaker-profile.md](./M22-speaker-profile.md), [./M25-task-runtime.md](./M25-task-runtime.md), [./M27-speakers-admin.md](./M27-speakers-admin.md)** — six writers, one file. They import from the **`@/features/portal` barrel**, not from M06b.
- `listMySubmissions`/`getMySubmission` consumed by [./M41-speaker-edit-until-close.md](./M41-speaker-edit-until-close.md) (submission picker + the record being edited).
- Status chips: [./M25-task-runtime.md](./M25-task-runtime.md) and [./M41-speaker-edit-until-close.md](./M41-speaker-edit-until-close.md) import **`toPortalStatus`** from `@/features/submissions` (M18) — not from this barrel.
- The layout shell (`src/app/(portal)/portal/[eventSlug]/layout.tsx`, nav + impersonation banner) is the mount point every later portal route nests under — [./M22-speaker-profile.md](./M22-speaker-profile.md)'s `/profile`, [./M25-task-runtime.md](./M25-task-runtime.md)'s `/tasks`, [./M41-speaker-edit-until-close.md](./M41-speaker-edit-until-close.md)'s `/submissions/[id]/edit`, and [./M26-resource-pages.md](./M26-resource-pages.md)'s `/resources` (WS-C, Monday) all render inside it.

## Step-by-step implementation

0. **Contact-write helpers — ship in the first hour; they gate M06b Sat PM and M18 Sat PM.** Create `src/features/portal/server/contacts.ts` with **exactly** `getOrCreateContact(tx, eventId, email)` and `updateContactFields(dbOrTx: DbOrTx, eventId, contactId, partial)` (resolution #13, signatures copied character-for-character from [M02](./M02-shared-contracts.md) §11; `DbOrTx` lets M22/M27's single-statement saves pass the `neon-http` handle while transactional writers pass `tx`) and re-export both from the barrel. `getOrCreateContact` is an `INSERT … ON CONFLICT (event_id, email) DO UPDATE SET updated_at = now() RETURNING id` on the lower-trimmed email; `updateContactFields` builds its `SET` clause from **only the keys present in `partial`** — never a whole-row update, because a stale form-task write-back must not clobber a fresher profile save. This is a ~40-line file and it is on the critical path for six modules across four lanes. **Done when:** `import { getOrCreateContact } from '@/features/portal'` typechecks from `features/auth` and `features/submissions`, and a PGlite test proves a second call with the same email returns the same `contactId` and touches no other column.

1. **Contract-first slice.** Write `src/features/portal/index.ts` exporting the signatures above as typed stubs returning fixture data (one fixture submission, one fixture contact) so `M22`–`M25`, `M41` (all built by the same agent later, but also so any early cross-check compiles) have a real barrel from hour one. **Done when:** `pnpm typecheck` passes importing every export from a scratch file.

2. **`requirePortalContext(eventSlug)`** in `server/guards.ts`.
   - Calls M06b's `requirePortal(eventSlug)` to get `{contactId, eventId, impersonatedByUserId?}`.
   - Loads the `events` row (via the events feature barrel) and the `contacts` row (`(eventId, contactId)` composite — IDOR-proof by construction).
   - Returns a redirect to `/portal/[eventSlug]/login` on no session — never a silent fallback to admin identity (R4 IDOR rule).
   - **Done when:** unit test with a forged/missing cookie redirects; a valid session resolves the right contact.

3. **Portal status mapping — import, do not write one.** `import { toPortalStatus } from '@/features/submissions'` ([M18](./M18-submission-mutations-notify.md) ships it **pure, in its first 30-minute contract slice**, so there is no implementation wait). It maps `draft→'draft'`, `pending|accept_queue|decline_queue→'pending'`, `accepted→'accepted'`, `declined→'declined'`, `withdrawn→'withdrawn'`, and ends in `assertNever` (R5).
   - **Do not add a second mapping** (`mapSubmissionStatusForPortal` and friends). Two implementations of a 7-state enum in two feature folders is exactly the drift resolution #8's single-owner discipline exists to prevent — and M18's guardrail already says "it is the single mapping; WS-D imports it".
   - Queue states must **never** render their literal name in the portal (analysis trap #17: leaking Accept Queue/Decline Queue to a speaker is a designed bug) — grep your own diff for the literal strings.
   - **Done when:** the Home widget, the list and the detail page all render their chip through `toPortalStatus`, and `grep -rn "accept_queue" src/features/portal` matches nothing outside a comment.

4. **`listMySubmissions(eventId, contactId)`.**
   - Query `submissions JOIN submission_participants ON (submission_id, event_id)` WHERE `submission_participants.contact_id = $contactId AND event_id = $eventId`.
   - Returns `{id, code, title, status: toPortalStatus(status), trackName, formatName, isPrimary}[]` ordered by `submitted_at DESC NULLS LAST`.
   - This is this module's own read against the `submissions`/`submission_participants` tables — features may read tables outside their DDL-ownership column via their own `server/queries.ts`; only writes are centralized (resolution #8).
   - **Done when:** PGlite test: a contact sees only submissions they participate in; a mismatched `contactId` returns `[]`, never another speaker's row (IDOR test, cited in AC).

5. **`getMySubmission(eventId, contactId, submissionId)`.**
   - Same join, single row, `null` if the contact isn't a participant — never a 403/500; the caller renders `notFound()`.
   - Returns title, `description_html` (render via `<RichTextView>`), track/format chip labels, status, submitted/decided dates, participant list (name + primary badge).
   - **Deliberately does not render per-question CFP answers.** The full Q&A snapshot view is out of scope here — that surface belongs to M17's admin Answers tab and M41's edit page, both of which need `FormFieldRendererProps`; this module has no dependency on M15's renderer.
   - **Done when:** detail page renders every seeded field with `<Dash>` for nulls (R10) and never crashes on the seeded all-nulls submission row.

6. **Home page** (`app/(portal)/portal/[eventSlug]/page.tsx`, RSC): three-widget layout matching the reference product —
   - **My Submissions (n)** card: header with "View All" → `/submissions`; up to 3 rows `"SESS-{code} – {title}"` + track/format label + `<StatusBadge>`; empty state "No submissions yet."
   - **My Profile** card: avatar (headshot via `/f/{fileId}` or initials fallback), name, email, "View more" → `/profile` (M22's route; link renders even before M22 ships).
   - **Tasks** card (full width): sub-tabs **All / My Tasks (n) / Submissions (n)** (shadcn `Tabs`), a Filter `DropdownMenu` (visual only in this module — wiring lands with M25), two collapsible sections "My Tasks" and "Submission Tasks" (shadcn `Accordion`, Open All/Collapse All buttons) reading **directly from `task_assignments_v` filtered by `contact_id = $contactId`** (the view already encodes the resolution #14 fan-out rule — no re-derivation here). Empty states: "No submission tasks found." / "No tasks found." Clicking a task row links to `/tasks/[taskId]` (M25's route — 404s until M25 ships, acceptable for a Sat/Sun build).
   - **My Sessions** card (only rendered when `getMySessions` returns ≥1 row): scheduled time + room in event tz via `<TzTime>`.
   **Done when:** Home renders correctly for (a) a seeded accepted+scheduled speaker, (b) a seeded speaker with zero submissions/tasks (empty second event), without crashing either way.

7. **Portal nav + impersonation banner** (`components/shell/`, mounted in `layout.tsx`).
   - Horizontal pill nav: Home, Submissions, Profile, Tasks, Resources. The Resources link renders now and 404s until M26 lands Monday — acceptable.
   - Account menu: avatar + name, dropdown with Profile, "Back to Admin Mode" (*only if* `impersonatedByUserId` is set), Logout.
   - Impersonation banner: a full-width strip "Viewing as {contact name} — Back to Admin Mode" when impersonated.
   - **Done when:** the banner renders for an admin-impersonated session and not for a normal speaker session; every impersonated write elsewhere in the portal is attributable — verified once M22/M25 land, since this module only renders the banner and exposes `impersonatedBy` from `requirePortalContext`.

8. **Submissions list + detail routes.**
   - `app/(portal)/portal/[eventSlug]/submissions/page.tsx` — table or card list, one row per `listMySubmissions` result, `<StatusBadge>`, links to detail.
   - `.../submissions/[submissionId]/page.tsx` — renders `getMySubmission`, read-only, no Edit CTA here (M41 adds it).
   - **Done when:** an accepted+scheduled seeded speaker's detail page shows correct status; a submission belonging to another contact 404s via direct URL guess (IDOR test).

9. **Client refetch wiring.**
   - `GET /api/internal/portal/submissions` and `.../submissions/[id]` — `defineHandler`, portal auth, thin wrappers over steps 4/5.
   - TanStack Query hooks in `hooks/` with `refetchOnWindowFocus: true` — "status freshness" per the catalog AC (a just-accepted speaker must not see stale Pending on refocus).
   - **Done when:** `curl` with a valid portal session cookie against both routes returns the same shape the RSC page hydrated as `initialData`.

10. **Seed module — `scripts/seed/portal.ts` (WS-D-owned; ship it Sat PM).** Four downstream modules render against this data and none of them can write it: [M36](./M36-reminder-scan.md)'s CP3 gate item is the seeded overdue task, [M38](./M38-dashboard.md) builds its Monday dashboard against it, [M25](./M25-task-runtime.md) has "3 seeded tasks" as its fixture, and [M23](./M23-tasks-admin.md)'s AC counts them. Content per [M09](./M09-seed-demo-script.md) §3:
    - **3 `portal_tasks`**, one per completion mode (manual / form / file_request), with **one due `now − 2d`** so the overdue list is never empty and the reminder scan has a due row on its first tick;
    - mixed `task_completions` (some done, some open);
    - **1 `file_request`** (title, instructions, accepted extensions, max size);
    - **2 `context='portal'` forms** (profile-update, session-info) with snapshots produced by `compileFormSnapshot` — these are also cut-line #13's fallback, and [M24](./M24-portal-form-builder.md) Step 1 owns authoring their field sets;
    - **2 `resource_pages`**, one containing a YouTube `iframe` (the `wide` sanitizer profile) and one containing a `<script>` that must be stripped.
    Deterministic UUIDv5 ids via `seedId`; idempotent `ON CONFLICT (id) DO UPDATE`. Register with the architect-owned `scripts/seed/index.ts` orchestrator after `agenda`.
    **Done when:** `pnpm seed && pnpm seed` is a no-op the second time, `SELECT count(*) FROM portal_tasks WHERE due_at < now()` is 1, and `SELECT count(*) FROM form_versions fv JOIN forms f ON f.id = fv.form_id WHERE f.context = 'portal'` is 2 with both snapshots zod-parsing as `FormSnapshot`.

## Acceptance criteria

Copied verbatim from the catalog (PLAN.md §4, M21), plus verification commands:

- Speaker sees only their own data (IDOR: PGlite test on mismatched contactId returns nothing) — `pnpm vitest run src/features/portal/server/queries.test.ts -t idor`.
- Queue states render as Pending — `pnpm vitest run src/features/submissions/server/mutations.test.ts -t toPortalStatus` (M18 owns the mapping and its table-driven test) plus a render assertion here that no portal surface prints `accept_queue`/`decline_queue`.
- An accepted+scheduled seeded speaker sees their slot time/room — manual check against seed once M28's real `getMySessions` is swapped in; fixture-covered until then.
- All widgets have empty states (empty second event proves it) — manual click-through on `/portal/empty-conf` (seeded empty event).

## Guardrails

- **IDOR (R4):** every query here takes `(eventId, contactId, ...)` and both must match the session — never trust a `submissionId` alone. This is the single highest-value bug class in this module.
- **Never leak queue states.** `accept_queue`/`decline_queue` must render as "Pending" everywhere in this module (Home widget, list, detail) — grep your own diff for the literal strings before marking a step done.
- **R10 nullable-render:** the seeded all-nulls submission row and the empty second event are your two eyeball tests; every table cell / detail row must use `<Dash>` or a designed empty state, never interpolate a possible `null`.
- **Impersonation (R4/analysis trap #16):** never let a missing/invalid portal session silently fall back to an admin identity — `requirePortalContext` always redirects to login on failure, full stop.
- **Do not build the Answers/Q&A panel here.** It is tempting to reuse `<FormFieldRenderer>` for a "nice" read-only detail view, but that pulls in the `FormFieldRendererProps` dependency (reserved for M25/M41) two days early and this module has no dashed edge to M15 in the dependency graph — keep the detail page to typed-column fields only.
- **Status freshness (analysis trap #17):** TanStack Query defaults here must include `refetchOnWindowFocus: true`; a stale "Pending" after an admin accepts+notifies while the speaker's tab is open is a designed failure mode judges will hit.
- **Counts consistency (analysis trap #18):** compute the tab counts (`My Tasks (n)`, `Submissions (n)`) from the same `task_assignments_v` query result the sections render, never a second aggregate query — drift here is a visible bug.

## If blocked

If M06b's real portal session isn't ready: finish steps 3–6 against a hardcoded fixture contact/session (matching M06b's Phase-0 stub shape) so the UI and queries are fully built; swap `requirePortal` the hour it lands. If blocked on both M06b and M05a: move to polishing M07/M05b (this agent's Saturday modules) or write the PGlite IDOR + status-mapping unit tests (step 3/4) against a hand-seeded schema — they need only M03, not M06b.
