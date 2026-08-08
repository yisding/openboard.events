# M27 — Speakers admin + impersonation

| | |
|---|---|
| **Status** | NOT STARTED |
| **Workstream / executing agent** | WS-C · Submissions Review — **executing agent differs from the feature folder**: WS-C owns `features/portal/admin/**` by declared temporary file-ownership on Monday (PLAN §4/§6). WS-D owns the rest of `features/portal`. |
| **Scheduled** | **Mon** (CP3: dashboard deep-links land the same night; comms history uses fixture rows until [M37](./M37-comms-admin-ui.md) lands Tue). |
| **Size** | M (~half-day) |
| **Paths owned** | `src/features/portal/admin/server/queries.ts` · `src/features/portal/admin/server/mutations.ts` · `src/features/portal/admin/components/**` · `src/features/portal/admin/index.ts` · `src/app/(admin)/events/[eventId]/speakers/page.tsx` · `src/app/(admin)/events/[eventId]/speakers/[contactId]/page.tsx` · `src/app/api/internal/speakers/[eventId]/route.ts` · `src/app/api/internal/speakers/[eventId]/[contactId]/route.ts` |

## Objective

Portals → Speakers gives organizers one screen for every contact in the event: a filterable table (accepted speakers, missing bio, missing headshot, confirmation status, search) and a detail page combining profile, submissions, task status and comms history. From it an organizer fixes a typo'd email, overrides a confirmation status (the manual counterpart to `notifyDecisions`' auto-confirm), and opens the portal **as** that speaker with an impersonation banner. The dashboard's missing-asset alerts deep-link straight into the pre-filtered list.

## Dependencies

**Hard (blocks start):**
- [M03](./M03-db-schema-migrations.md) — `contacts`, `submission_participants`, `submissions`, `file_assets` and the views `accepted_speakers_v`, `missing_assets_v`, `speaker_outstanding_v`, `task_assignments_v` migrated on `sb-dev`.
- [M05a](./M05a-admin-shell-ui.md) — `DataTable`, `StatusBadge`, `EmptyState`, `ConfirmDialog`, `Dash`, `TzTime`; the `(admin)` layout with the PORTALS → Speakers nav item.
- [M06a](./M06a-admin-auth.md) — `requireAdmin(eventId)`.
- [M06b](./M06b-portal-auth.md) — the impersonation endpoint + banner: admin "Open portal as X" creates a `portal_sessions` row with `impersonated_by_user_id` (`POST /api/internal/auth/[eventId]/impersonate { contactId }` — **PROPOSED path**; use whatever M06b exports, do not mint sessions yourself).

**Soft (start against stub/fixture):**
- [M34](./M34-comms-outbox-dispatcher.md) — `listLog(eventId, filters): CommLogRow[]` via the comms barrel (declared graph edge M34 -.-> M27). Build the comms-history card against **`src/shared/fixtures/comm-log.ts`** (M02's Phase-0 fixture) typed as `CommLogRow[]`; swap the import to `@/features/comms` when M34/M37 land (one line, Tue).
- [M22](./M22-speaker-profile.md) — the portal-side profile writes the same contact fields. No blocking; both go through `updateContactFields`.
- [M18](./M18-submission-mutations-notify.md) — auto-confirm sets `confirmation_status='confirmed'` at notify; M27's override is the manual counterpart. Read `toPortalStatus` from the submissions barrel for the submissions list chips.
- [M38](./M38-dashboard.md) — consumes the deep-link query contract below; ship the params first so M38 can link on Monday.

## Provides (interfaces others consume)

```ts
// src/features/portal/admin/index.ts
export async function listContacts(eventId: EventId, filters: ContactFilters): Promise<{ rows: ContactListRow[]; total: number }>;
export async function getSpeakerDetail(eventId: EventId, contactId: ContactId): Promise<SpeakerDetailDTO>;
export async function updateSpeakerEmail(eventId: EventId, contactId: ContactId, email: string): Promise<void>;
export async function setConfirmationStatus(eventId: EventId, contactId: ContactId,
  status: 'unconfirmed' | 'confirmed' | 'declined'): Promise<void>;

type ContactFilters = { q?: string; accepted?: boolean; missing?: 'bio' | 'headshot' | 'either';
  confirmation?: 'unconfirmed' | 'confirmed' | 'declined'; sort?: 'name' | 'openTasks' | 'confirmation';
  dir?: 'asc' | 'desc'; page?: number; pageSize?: number };
type ContactListRow = { contactId: ContactId; name: string; email: string; jobTitle: string | null; company: string | null;
  headshotFileId: string | null; confirmationStatus: 'unconfirmed' | 'confirmed' | 'declined'; isAcceptedSpeaker: boolean;
  submissionCount: number; openTasks: number; overdueTasks: number; missingBio: boolean; missingHeadshot: boolean };
type SpeakerDetailDTO = { contact: ContactListRow & { bioHtml: string | null; pronouns: string | null; gender: string | null;
    salutation: string | null; links: { linkedin: string | null; twitter: string | null; facebook: string | null; website: string | null };
    unsubscribedAt: string | null };
  submissions: Array<{ submissionId: SubmissionId; code: number; title: string; portalStatus: string; isPrimary: boolean }>;
  tasks: Array<{ taskId: string; name: string; submissionId: SubmissionId | null; dueAt: string | null; completed: boolean; overdue: boolean }>;
  comms: CommLogRow[] };
```

`CommLogRow` is **M02's contract, not yours** — `import type { CommLogRow } from '@/shared/contracts'` and do not restate its fields here (the earlier inline copy drifted from M34's actual field names). It carries `recipientEmail`/`recipientName`, **not** `contactEmail`, and deliberately has **no** `bodyRenderedHtml` (that lives on the sibling `CommLogDetail`, which only [M37](./M37-comms-admin-ui.md)'s detail sheet loads). Point the Monday fixture at **`src/shared/fixtures/comm-log.ts`** — the file [M02](./M02-shared-contracts.md) §10 already ships — rather than writing a second one.

`TemplateKey` is the frozen **8-key** enum: `submission_received · submission_accepted · submission_declined · task_assigned · task_reminder · schedule_assigned · schedule_changed · portal_login`. Render a human label per key in one map beside the timeline component.

Also exported from this module (it already queries the view, and [M40](./M40-public-api.md)'s `/speakers/outstanding-tasks` needs exactly this shape):
```ts
export async function getOutstandingTasksView(eventId: EventId): Promise<OutstandingTasksRow[]>;
// OutstandingTasksRow = {contactId, name, openCount, overdueCount, doneCount} (M02 contracts/task.ts),
// straight from speaker_outstanding_v. Named in M02 §11's portal barrel; this module implements it.
```

**Deep-link query contract (consumed by [M38](./M38-dashboard.md)) — frozen in contracts, not in a channel message:** the param names live in `SPEAKERS_DEEPLINK_PARAMS` ([M02](./M02-shared-contracts.md) §9b) so neither side can re-invent them: `/events/[eventId]/speakers?missing=bio` · `?missing=headshot` · **`?missing=either`** (the combined bio-or-headshot case M38's alert bar and attention strip link to) · `?accepted=1` · `?confirmation=unconfirmed` · `?sort=openTasks&dir=desc`. **There is no `?filter=` param.**

Routes: `/events/[eventId]/speakers`, `/events/[eventId]/speakers/[contactId]`. API: `GET /api/internal/speakers/[eventId]`, `GET|PATCH /api/internal/speakers/[eventId]/[contactId]`.

**PROPOSED:** all types and route/query shapes above (the catalog specifies only `listContacts(eventId, filters)` and the two pages).

**Consumers:** [M38](./M38-dashboard.md) (attention strip + top-speakers list click-through), [M09](./M09-seed-demo-script.md) (demo-script step "open the portal as a speaker").

## Step-by-step implementation

1. **Contract-first slice.** `src/features/portal/admin/index.ts` with the four signatures **plus `getOutstandingTasksView`** as throwing stubs + the DTO types; the deep-link params are already frozen as `SPEAKERS_DEEPLINK_PARAMS` in contracts, so M38 builds its links against that constant rather than against a channel message. Ask WS-D to re-export from the portal barrel if any other feature needs it (only M38 does, and it can import the barrel).
   **Done when:** `pnpm tsc --noEmit` green; M38's attention-strip links compile.

2. **`listContacts`.** One query over `contacts` LEFT JOINing: `accepted_speakers_v` (→ `isAcceptedSpeaker`), `missing_assets_v` (→ `missingBio`/`missingHeadshot`), `speaker_outstanding_v` (→ `openTasks`/`overdueTasks`), and a submission count from `submission_participants`. Filters map 1:1 to the query params above; `q` matches first/last name and email (case-insensitive). Sorting by `openTasks` puts nulls last.
   **Done when:** `curl -s "$BASE/api/internal/speakers/$EVENT_ID?missing=bio&accepted=1" -b admin.cookie | jq '.data.total'` equals `SELECT count(*) FROM missing_assets_v WHERE missing_bio` for that event.

3. **Speakers table.** Columns: **Speaker** (avatar from `/f/{headshotFileId}` or initials + name), **Email**, **Company / Job title**, **Confirmation** (`<StatusBadge>` green/grey/red), **Submissions** (count + `SESS-n` chips, max 2 + "+n"), **Tasks** (`3 open · 1 overdue`, overdue in red), **Missing** (chips "Bio"/"Headshot"), row click → detail. Toolbar: search, filter chips for `Accepted speakers` / `Missing bio` / `Missing headshot` / confirmation, all writing the URL params (so deep links and the back button work). `<EmptyState>` per filter ("No speakers are missing a bio — nice.").
   **Done when:** hitting `/events/[eventId]/speakers?missing=headshot` from a cold load renders the filter chip active and the pre-filtered rows.

4. **Speaker detail page.** `/events/[eventId]/speakers/[contactId]`, four cards:
   - **Profile** — headshot, name, pronouns/gender/salutation, company/job title, links (external-safe `rel="noopener noreferrer"`), bio rendered through `<RichTextView>` (narrow allowlist), `Unsubscribed` notice if `unsubscribed_at` is set. Inline **email correction** (pencil → input → Save).
   - **Confirmation** — current status + an override control (`Confirmed` / `Unconfirmed` / `Declined`) with a one-line explanation: "Accepted speakers are confirmed automatically when you Notify; override here if they drop out."
   - **Submissions** — `SESS-n` · title · portal status chip via `toPortalStatus` (queue states render "Pending"), primary/co-speaker marker, link into the Abstracts drawer (`/events/[eventId]/submissions?submission=<id>`).
   - **Tasks & Comms** — open/overdue/completed task rows from `task_assignments_v`; comms history from `listLog(eventId, { contactId })` rendered as a timeline (template key, subject, status badge, `<TzTime>` sent_at, provider id). **Fixture rows until M34 lands.**
   **Done when:** the seeded speaker with 2 accepted sessions shows both submissions, their task rows, and (fixture or real) comms entries.

5. **`updateSpeakerEmail`.** Normalizes to `lower(btrim(email))`, validates with the contracts email schema, writes **only** via `updateContactFields(tx, eventId, contactId, { email })` (resolution #13). A collision with another contact in the same event maps the unique violation to a friendly field error: "Another speaker in this event already uses that address."
   **Done when:** a PGlite test asserts the friendly error on collision and that no other column is touched by the update.

6. **`setConfirmationStatus`.** Also via `updateContactFields` (`{ confirmationStatus }`). Invalidate the speakers list, the dashboard overview key, and — because `published_speakers_v` filters on `confirmation_status='confirmed'` — note in the UI that setting `declined` removes the speaker from the public gallery.
   **Done when:** flipping a confirmed speaker to `declined` makes them disappear from `/e/[slug]/speakers` within the 60s cache window (verify with a hard refresh) and moves a slice on the dashboard donut on the next poll.

7. **Impersonation.** "Open portal as {name}" button → M06b's impersonate endpoint → open `/portal/[eventSlug]` in a new tab; the portal shows the impersonation banner with **Back to Admin**. Never mint a session or token here; if M06b's endpoint is not ready, render the button disabled with a tooltip.
   **Done when:** the banner appears with the admin's name and Back-to-Admin returns to `/events/[eventId]/speakers/[contactId]`.

8. **Edge cases to build for explicitly** (each has a seeded row): a contact with **no submissions** (a co-speaker who never submitted — still listed, `isAcceptedSpeaker` false, no tasks); a contact who is a **co-speaker only** on an accepted submission (appears in `accepted_speakers_v` but owns **zero** submission-task assignments — resolution #14's fan-out rule; the Tasks card must show that honestly, not "0 of 0" as an error); a speaker on **two** accepted submissions (two independent submission-task rows); an **unsubscribed** contact (banner "Reminder emails suppressed"); a contact with a **missing headshot file** (`headshot_file_id` set but the asset row deleted → initials avatar, no broken image).
   **Done when:** each of the five rows renders correctly in the list and on the detail page with no console errors.

9. **Tests.** `src/features/portal/admin/server/queries.test.ts` (PGlite): filter combinations return the same rows as the underlying views; cross-event isolation; email-collision error; confirmation override changes `published_speakers_v` membership.
   **Done when:** `pnpm vitest run src/features/portal/admin` is green.

10. **Tuesday swap.** Replace the fixture comms import with `import { listLog } from '@/features/comms'` once [M34](./M34-comms-outbox-dispatcher.md)/[M37](./M37-comms-admin-ui.md) land, and link each row to the comms-log detail view (the rendered-body page — the judge-mode fallback surface).
   **Done when:** a real seeded `submission_accepted` row appears in the speaker's timeline with a working link to its rendered body.

## Acceptance criteria

**Catalog AC (verbatim):** dashboard missing-asset banner deep-links to the pre-filtered list; impersonated portal session shows banner and Back-to-Admin works; confirmation override immediately affects gallery + donut.

Verification:
- `pnpm vitest run src/features/portal/admin`.
- `curl -s "$BASE/api/internal/speakers/$EVENT_ID?missing=either" -b admin.cookie | jq '.data.rows[].missingBio'` matches `missing_assets_v`.
- Manual on the deployed preview: dashboard attention strip → click "2 speakers missing bio/headshot" → the list arrives pre-filtered; open portal as a speaker → banner → Back to Admin; set a confirmed speaker to `declined` → they vanish from `/e/[slug]/speakers`.

## Guardrails

- **Resolution #13 — contacts writes.** Every write here goes through `updateContactFields(tx, eventId, contactId, partial)`, **field-scoped, never whole-row**. A raw `UPDATE contacts` is a CI-grep failure and would clobber a concurrent portal profile save (analysis trap 5).
- **Resolution #15 — auto-confirm is the default.** This module is the *manual counterpart*; do not add a second automatic confirmation rule anywhere.
- **Queue states never leak:** the submissions card uses `toPortalStatus` from the submissions barrel — one mapping, imported, never reimplemented.
- **R4 scoping + IDOR:** `(eventId, contactId)` on every fn; a contact id from another event returns 404 (`notFound()`), never another event's row.
- **Views are the counting rule:** open/overdue task counts come from `task_assignments_v`/`speaker_outstanding_v` — never a hand-rolled join — so this page, the portal panel and the dashboard agree exactly (resolution #14's fan-out rule is consumed, never re-derived).
- **R9/R10:** bios are speaker-authored HTML → `<RichTextView>` only (narrow allowlist), and every nullable cell uses `<Dash>`; a contact with no name renders their email, not "undefined undefined".
- **Timezone:** all instants via `<TzTime>`/`formatInZone` in the event tz with the label.
- **Cross-folder ownership:** you are a guest in `features/portal`. Touch only `features/portal/admin/**` and the four route files listed; portal shell/nav/barrel changes are requests to WS-D.
- **Empty states:** no contacts at all, no missing assets, no comms yet, no tasks yet — verify on the empty second event.
- **Impersonation is cut-line #16** — if it slips, the page still ships; the demo script then uses a magic link from the comms log instead.

## If blocked

1. If [M06b](./M06b-portal-auth.md)'s impersonation endpoint is late: ship everything else, button disabled; it is a one-line wire-up later and is the lowest-value item here.
2. If the views are missing columns you expected: **do not** add a local join — file it with the architect (M03 owns views; additive-only) and use the raw tables temporarily behind a `TODO(M03)` comment with the view name.
3. Next in your lane: [M26](./M26-resource-pages.md) (same Monday, also portal-guest), then [M19](./M19-evaluation-scoring.md) finish, then [M20](./M20-csv-export.md) Tuesday.
4. **Standing WS-C duty (PLAN §6):** WS-C is designated swarm capacity for WS-B from Sun noon. If the Sunday-noon golden-path check was red, Monday's WS-C work (M26/M27) is the first thing to defer behind B2's wizard/pipeline queue — the CP2 spine outranks both. Re-plan Monday morning with the architect rather than starting M27 in parallel with a broken spine.
