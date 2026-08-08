# M38 — Dashboard

| | |
|---|---|
| **Status** | NOT STARTED |
| **Workstream / executing agent** | WS-F (Comms + Dashboard + Airtable + API) — feature folder `dashboard`. |
| **Scheduled** | **Monday** (both tabs). Live-updating Speaker Tracking is a CP3 (Mon night) demo item. |
| **Size** | L (≈1 day) |
| **Paths owned** | `src/features/dashboard/index.ts`, `src/features/dashboard/index.client.ts`, `src/features/dashboard/server/overview.ts`, `src/features/dashboard/server/queries.ts`, `src/features/dashboard/components/**`, `src/features/dashboard/hooks/**`, `src/features/dashboard/overview.test.ts`, `src/app/(admin)/events/[eventId]/dashboard/page.tsx`, `src/app/(admin)/events/[eventId]/page.tsx` (redirect → `/dashboard`), `src/app/api/internal/dashboard/[eventId]/overview/route.ts`. (**[M40](./M40-public-api.md) additionally owns `src/features/dashboard/server/api-keys.ts` and `src/features/dashboard/components/ApiKeysPanel.tsx` — declared cross-module grant inside this folder.**) |

## Objective
`/events/[eventId]/dashboard` answers the brief's feature #6 — "real-time dashboard showing which speakers still have outstanding onboarding tasks" — from **one** aggregated endpoint over the 8 read-model views, polled every 30 s. The **Speaker Tracking** tab (CORE) shows accepted-speaker and outstanding-task counts, a ranked top-speakers-by-open-tasks list, an overdue list, a confirmation-mix donut, and missing-bio/headshot alerts, all click-through to the fixing surface. The **Today** tab (SHOULD) adds the greeting + days-to-event, KPI/status tiles, the attention strip, per-form progress cards, and recent submissions. Completing a task in the portal drops the count here within one poll.

## Dependencies
- **Hard (blocks start):**
  - [M03](./M03-db-schema-migrations.md) — all 8 views migrated on sb-dev: `accepted_speakers_v`, `task_assignments_v` (**with the resolution-#14 fan-out rule in the SQL**), `speaker_outstanding_v`, `missing_assets_v`, `submission_status_counts_v`, `submission_ratings_v`, `published_sessions_v`, `published_speakers_v`.
  - [M05a](./M05a-admin-shell-ui.md) — `(admin)` layout + sidebar (the Dashboard nav item), `DataTable`, `StatusBadge`, `EmptyState`, `Dash`, `TzTime`.
  - [M04](./M04-shared-libs.md) — `defineHandler`, `time.ts`'s `daysToEvent`/`formatInZone`, `query-keys.ts`, `api-client.ts`.
- **Soft (start against stub/fixture):**
  - [M05b](./M05b-rich-ui-primitives.md)'s `<StatTile>` and `<Donut>` (single SVG, no chart library). If not exported yet, render a plain bordered card with a big number and a legend list; **swap step:** replace the two component imports, no data changes.
  - Live data: build entirely against [M09](./M09-seed-demo-script.md)'s seed (12 speakers with mixed missing bio/headshot, ~25 submissions across all statuses incl. 2 drafts, 3 tasks with one overdue, ~15 sessions + 3 unscheduled, **plus the empty second event** as the standing empty-state fixture). Real completions from [M25](./M25-task-runtime.md) flow through the same views with **zero code change** — that is the whole point of reading views.
  - [M27](./M27-speakers-admin.md)'s deep-link targets land Monday too. **The param contract is frozen in `SPEAKERS_DEEPLINK_PARAMS` ([M02](./M02-shared-contracts.md) §9b) — build the links against that constant, not against a guess.** It is `?missing=bio|headshot|either`, `?accepted=1`, `?confirmation=…`, `?sort=openTasks&dir=desc`; **there is no `?filter=` param**. If a param is not yet honored, the link still lands on the speakers list.

## Provides (interfaces others consume)
```ts
// src/features/dashboard/index.ts
export async function getOverview(eventId: EventId): Promise<DashboardOverview>;   // PROPOSED (shape below)
export type DashboardOverview = {
  event: { id: string; name: string; timezone: string; startsAt: string; daysToEvent: number };
  kpis: { submissions: number; acceptedSpeakers: number; scheduledSessions: number; unscheduledAccepted: number };
  statusCounts: Record<SubmissionStatus, number>;                       // all 7 keys always present, zero-filled
  speakerTracking: {
    acceptedSpeakers: number;
    outstandingTasks: number;
    overdueTasks: number;
    topByOutstanding: { contactId: string; name: string; openCount: number; overdueCount: number }[];   // ≤8, desc
    overdue: { contactId: string; name: string; taskId: string; taskName: string;
               submissionCode: string | null; dueAt: string }[];                                        // ≤10, oldest first
    confirmationMix: { confirmed: number; unconfirmed: number; declined: number };
    missingAssets: { speakers: number; bios: number; headshots: number };
  };
  attention: { code: 'unscheduled_accepted'|'awaiting_decision'|'missing_assets'; count: number; href: string }[];
  forms: { formId: string; name: string; status: 'draft'|'open'|'closed'; closesAt: string | null;
           submitted: number; drafts: number }[];
  recentSubmissions: { id: string; code: string; title: string; status: SubmissionStatus; source: string;
                       speakers: string[]; tags: string[]; submittedAt: string | null }[];              // ≤10
};
```
- `GET /api/internal/dashboard/[eventId]/overview` — the single endpoint; consumed by this page's TanStack query and **reused verbatim by [M40](./M40-public-api.md)'s keyed `/api/v1/events/[slug]/stats`** (no second counting implementation).
- `<SpeakerTrackingPanel overview>` exported from `index.client.ts` — available to [M27](./M27-speakers-admin.md) if it wants the same ranked list (optional, not a blocking edge).

## Step-by-step implementation

1. **Contract-first slice.** Create `src/features/dashboard/index.ts` exporting `getOverview` (throwing `NOT_IMPLEMENTED`) plus the full `DashboardOverview` type, and create the route handler `src/app/api/internal/dashboard/[eventId]/overview/route.ts` via `defineHandler` returning it. Commit a typed fixture `src/features/dashboard/fixtures.ts` (`FIXTURE_OVERVIEW: DashboardOverview`) with realistic non-zero numbers **and** an all-zero variant. Tell [M40](./M40-public-api.md) (same agent, Monday PM) that `/stats` can be written against this type immediately.
   **Done when:** `pnpm tsc --noEmit` green; `curl …/api/internal/dashboard/$EVENT/overview` returns the fixture JSON.
2. **The one aggregated query** — `server/overview.ts`. **One statement, grouped CTEs, no widget-per-query waterfall** (speed bonus, analysis trap #14). Sketch:
   ```sql
   WITH ev AS (SELECT id, name, timezone, starts_at FROM events WHERE id = $1),
   sc AS (SELECT status, n FROM submission_status_counts_v WHERE event_id = $1),
   spk AS (SELECT count(*) AS n FROM accepted_speakers_v WHERE event_id = $1),
   tasks AS (SELECT count(*) FILTER (WHERE NOT completed) AS open_n,
                    count(*) FILTER (WHERE overdue)       AS overdue_n
             FROM task_assignments_v WHERE event_id = $1),
   top AS (SELECT o.contact_id, c.first_name, c.last_name, o.open_count, o.overdue_count
           FROM speaker_outstanding_v o JOIN contacts c ON c.id = o.contact_id
           WHERE o.event_id = $1 AND o.open_count > 0
           ORDER BY o.open_count DESC, o.overdue_count DESC, c.last_name LIMIT 8),
   od AS (SELECT a.contact_id, c.first_name, c.last_name, a.task_id, t.name AS task_name,
                 s.code AS submission_code, a.due_at
          FROM task_assignments_v a JOIN portal_tasks t ON t.id = a.task_id
          JOIN contacts c ON c.id = a.contact_id
          LEFT JOIN submissions s ON s.id = a.submission_id
          WHERE a.event_id = $1 AND a.overdue ORDER BY a.due_at ASC LIMIT 10),
   mix AS (SELECT c.confirmation_status, count(*) AS n
           FROM contacts c JOIN accepted_speakers_v a ON a.contact_id = c.id
           WHERE c.event_id = $1 GROUP BY 1),
   miss AS (SELECT count(*) FILTER (WHERE missing_bio OR missing_headshot) AS speakers,
                   count(*) FILTER (WHERE missing_bio)      AS bios,
                   count(*) FILTER (WHERE missing_headshot) AS headshots
            FROM missing_assets_v WHERE event_id = $1),
   sched AS (SELECT count(*) AS n FROM published_sessions_v WHERE event_id = $1),
   unsched AS (SELECT count(*) AS n FROM submissions s
               WHERE s.event_id = $1 AND s.status = 'accepted'
                 AND NOT EXISTS (SELECT 1 FROM sessions x WHERE x.submission_id = s.id AND x.starts_at IS NOT NULL)),
   forms AS (…counts per form from submissions grouped by form_id, drafts separated…),
   recent AS (…10 newest non-draft submissions + speaker names + tag names…)
   SELECT json_build_object(…) AS overview;
   ```
   Return one JSON blob and zod-parse it into `DashboardOverview` (R2: the DB is a trust boundary). **Zero-fill** every `statusCounts` key and every `confirmationMix` key in TypeScript so the UI never indexes into a missing key.
   **Done when:** `pnpm vitest run src/features/dashboard/overview.test.ts` (PGlite, seeded) asserts: `statusCounts` has all 7 keys; `kpis.submissions` equals `sum(statusCounts) - statusCounts.draft`; the empty second event returns all zeros and empty arrays without throwing.
3. **The counting rule — write it down once, here.** Put this comment block at the top of `server/overview.ts` and mirror it in the UI tooltips:
   - **Submissions KPI** = submissions where `status <> 'draft'` (drafts have their own tile). Sessionboard's own screenshots contradict themselves (4 vs 2); ours must not (analysis trap #6).
   - **Accepted speakers** = `count(accepted_speakers_v)` — derived from `EXISTS accepted submission`, never a stored flag.
   - **Outstanding tasks** = `count(task_assignments_v) FILTER (NOT completed)`; **overdue** = `open AND due_at < now()` — the view's definition, not a re-derivation.
   - **Fan-out (resolution #14)**: submission-targeted tasks → the primary contact only, once per accepted submission; contact-targeted → members of `accepted_speakers_v`. The dashboard **must** equal [M21](./M21-portal-shell.md)'s portal panel and [M23](./M23-tasks-admin.md)'s matrix because all three read the same view.
   - **Missing assets**: an accepted speaker is flagged if bio is empty (whitespace/tags-only counts as empty) **OR** headshot is absent; the banner counts *asset instances* (`2 bios, 2 headshots`), the speaker count counts *people* (analysis trap #8).
   **Done when:** the comment exists and a PGlite test asserts dashboard `outstandingTasks` equals the sum of `speaker_outstanding_v.open_count` for the event.
4. **Page shell + polling.** `src/app/(admin)/events/[eventId]/dashboard/page.tsx` (RSC, `force-dynamic`, `requireAdmin`) calls `getOverview` directly and hydrates it as TanStack `initialData` under `qk('dashboard', eventId, 'overview')` with `refetchInterval: 30_000` and `refetchOnWindowFocus: true` — this **is** the "real-time" story (no websockets). Tabs `?tab=today|speakers`; **`speakers` (Speaker Tracking) is the default when the event has any accepted speaker**, otherwise `today`. Also add `src/app/(admin)/events/[eventId]/page.tsx` → `redirect('./dashboard')`.
   **Done when:** the tab is deep-linkable, and DevTools shows exactly **one** network request per 30 s poll (not one per widget).
5. **Speaker Tracking tab (CORE — build this before Today).** Components under `components/`:
   - Two big-number tiles: `ACCEPTED SPEAKERS`, `OUTSTANDING SPEAKER TASKS` (`<StatTile>`), with the overdue count as a red sub-label.
   - `TOP SPEAKERS BY OUTSTANDING TASKS`: ranked horizontal bar list (name, count, bar width = count/max), each row links to `/events/[id]/speakers/[contactId]` ([M27](./M27-speakers-admin.md)). Empty → `<EmptyState title="No outstanding tasks" hint="Assign tasks in Portal → Tasks.">`.
   - `SPEAKER CONFIRMATION MIX`: `<Donut>` over confirmed/unconfirmed/declined with a legend of counts + percentages. **No divide-by-zero**: total 0 → render the empty state, never `NaN%`.
   - `OVERDUE` list: task name · speaker · SESS code (`<Dash>` when contact-targeted) · due date via `<TzTime>` in event tz with the zone label; oldest first.
   - Missing-assets alert bar: "2 accepted speakers are missing a bio or headshot (2 bios, 2 headshots)" → deep link **`/events/[id]/speakers?missing=either`** (M27's frozen param for the combined bio-or-headshot case; `?filter=missing` would silently open the unfiltered list and fail M27's own AC).
   **Done when:** with the seed loaded, the tab shows non-zero numbers for every widget, and completing the seeded overdue task in the portal drops `outstandingTasks` by 1 within one poll.
6. **Today tab (SHOULD).** Header kicker `SATURDAY, AUGUST 8 · 65 DAYS TO EVENT` — the day/date from `formatInZone(now, event.timezone, …)` and the countdown from **`daysToEvent`** (calendar-day diff in event tz; never `hours/24`, never a client clock) — plus `Good morning, {firstName}` (morning/afternoon/evening by event-tz hour).
   - KPI tiles: Submissions, Accepted Speakers, Scheduled Sessions, Unscheduled Accepted. (Exhibitors/Sponsors are dropped — always 0 in the real product.)
   - SUBMISSION STATUS row: Accepted · Pending · Declined · Drafts · Withdrawn (queue states fold into their decision tile with a tooltip explaining the fold).
   - **"Also check" attention strip** from `overview.attention`, each an inline alert with a deep link: `N accepted sessions still need a time slot` → `/events/[id]/agenda?view=day`; `N session submissions are awaiting a decision` → `/events/[id]/submissions?status=pending`; `N accepted speakers are missing a bio or headshot` → **`/events/[id]/speakers?missing=either`**. Show at most 2 + a `+N more` overflow.
   - Form progress cards: per CFP form — name, `<StatusBadge>` Open/Closed, "Closes in a month" (relative, computed from `closes_at` in event tz), submitted count, drafts count, **View** (public `/submit/[slug]/[formId]`) and **Manage** (`/events/[id]/forms/[formId]`) buttons.
   - Recent Submissions `<DataTable>`: **Source** (form name or `Manual`), **Title**, **Status** badge, **Speakers** (`<Dash>` when none), **Tags** chips, **Submitted** (full event-tz timestamp with zone label, e.g. `Fri August 7, 2026, 11:51:05 PM PDT` — the real product prints the seconds and the zone), "View all" → Abstracts. Newest first, 10 rows, non-draft only.
   - The `forms` CTE: one row per `context='cfp'` form with `status`, `closes_at`, `count(*) FILTER (WHERE status<>'draft')` as submitted and `count(*) FILTER (WHERE status='draft')` as drafts — **drafts are real server rows now**, so this number must equal [M12](./M12-form-builder-core.md)'s form-card count and the Abstracts Drafts tab. The `recent` CTE joins `submission_participants`→`contacts` for names and `submission_tags`→`tags` for chips, both aggregated with `array_agg` and `<Dash>`-safe on empty.
   **Done when:** every seeded surface renders non-empty, hostile seed rows (`;lkj`, 255-char title, RTL, `<img onerror>`) render escaped and do not break the layout, and the all-nulls seed row renders as `—` everywhere.
7. **Component file map + the empty-state strings.** Create exactly these under `components/` so the two tabs stay reviewable and cut-lines are surgical: `DashboardTabs.tsx`, `SpeakerTrackingPanel.tsx`, `TopSpeakersList.tsx`, `OverdueList.tsx`, `ConfirmationMix.tsx`, `MissingAssetsAlert.tsx`, `TodayPanel.tsx`, `KpiRow.tsx`, `StatusRow.tsx`, `AttentionStrip.tsx`, `FormProgressCards.tsx`, `RecentSubmissionsTable.tsx`, `WidgetBoundary.tsx`. Every widget's empty state is designed, not incidental (Sessionboard's own screenshots show ten of them):
   | widget | empty copy |
   |---|---|
   | Top speakers | `No outstanding tasks` · `Assign tasks in Portal → Tasks.` |
   | Overdue list | `Nothing overdue` · `Every assigned task is on time.` |
   | Confirmation mix | `No data` · `Accept a submission to see confirmation status.` |
   | Missing assets | (bar hidden entirely when 0) |
   | Attention strip | (strip hidden entirely when empty) |
   | Form progress | `No submission forms yet` · `Create one in Program → Forms.` |
   | Recent submissions | `No submissions yet` · `Share your CFP link to get started.` |
   **Done when:** `/events/[emptyEventId]/dashboard` renders every one of these strings (or correctly hides the two hidden-when-zero widgets) with no console errors.
8. **Graceful degradation.** Wrap each widget in an error boundary that **hides the widget** and logs, rather than crashing the page (design rule: "widgets hide on error, never crash the page"). If `getOverview` itself throws, the page renders the shell + a single retry banner.
   **Done when:** temporarily throwing inside the `forms` CTE mapping hides only the form cards; the rest of the page is intact.
9. **CP3 evidence + perf check.** On the deployed preview: open the dashboard, complete a task in the portal in another tab, watch the count drop on the next poll (record the clip/screenshot). Confirm the overview endpoint is a single query — log its duration and assert < 150 ms warm against sb-dev.
   **Done when:** the count-drop is demonstrated on the **deployed** preview and the timing line is in the CP3 notes.

## Acceptance criteria
**Catalog AC (verbatim):** completing a seeded task drops the outstanding count within one poll; counts match Abstracts tabs AND the portal task panel exactly (same views, same fan-out rule); empty second event renders all empty states.

Verification:
- `pnpm vitest run src/features/dashboard/overview.test.ts` (zero-fill, empty event, fan-out equality with `speaker_outstanding_v`).
- `curl -s "$APP_BASE_URL/api/internal/dashboard/$EVENT/overview" | jq '.speakerTracking.outstandingTasks'` before/after a portal task completion.
- Cross-check: `jq '.statusCounts'` vs the Abstracts tab counts ([M17](./M17-abstracts-table.md)) — same numbers, both from `submission_status_counts_v`.
- Cross-check: `jq '.speakerTracking.topByOutstanding'` vs one speaker's portal Tasks panel count ([M21](./M21-portal-shell.md)) — identical for the co-speakered seeded submission (exactly one assignment).
- Empty second event: open `/events/[emptyEventId]/dashboard` → every widget shows its designed empty state, no `NaN`, no `0%` donut crash.

## Guardrails
- **Views are the only read path.** The dashboard must not query raw tables for anything the views cover — that is how count-definition drift (analysis trap #6) gets in. The two allowed raw reads are `events` (name/tz/starts_at) and the `recent`/`forms` CTEs' joins for labels.
- **One endpoint, one query.** A widget-per-fetch waterfall fails the speed bonus and is a review-blocker. Adding a widget means adding a CTE, not a request.
- **Resolution #14's fan-out is consumed, never re-derived.** If the dashboard's number disagrees with the portal's, do not "fix" it here — the view is the single counting rule.
- **Resolution #15 (auto-confirm) feeds the donut**: `notifyDecisions` sets the primary contact to `confirmed`; [M27](./M27-speakers-admin.md) can override. A confirmation-mix change must be visible on the next poll, and an admin-declined speaker must simultaneously vanish from the public gallery ([M32](./M32-public-schedule-gallery.md)'s leakage test) — call this out in the demo script; it is a strong 30-second demo.
- **`daysToEvent` only** for the countdown — the off-by-one across midnight in the event tz is a classic and the greeting is the first thing a judge reads (S2).
- **All times rendered in event tz with the zone label** (`<TzTime>` / `formatInZone`). No date-lib import in this feature (CI grep restricts `date-fns*` to `time.ts`).
- **Nullable-render rule (R10):** every table cell and detail row uses `<Dash>`; the seed's all-nulls row exists to make a violation fail the eyeball pass.
- **Zustand is not allowed to hold any of this data** — it is server state; TanStack Query owns it. Only the active tab may be local UI state (and it lives in the URL anyway).
- Edge cases: 0 accepted speakers → donut and ranked list both show `No data` (Sessionboard's own screenshots do); a speaker with 0 open tasks must not appear in the ranked list; an overdue task whose contact was un-accepted disappears from the view instantly with no cleanup code; a form with no submissions shows "No submissions yet"; withdrawn/draft rows never leak into `recentSubmissions`.
- **Cut-line #8:** if Monday is tight, drop the Today tab's extras (form progress cards, recent submissions) and keep KPI tiles + attention strip + the whole Speaker Tracking tab. Speaker Tracking is CORE and is never cut.

## If blocked
- Blocked on [M03](./M03-db-schema-migrations.md)'s views: build the whole UI against `FIXTURE_OVERVIEW` (step 1) — the swap is one function body. This is the intended path; do not wait for data.
- Blocked on [M05b](./M05b-rich-ui-primitives.md): use the plain-card fallback for `<StatTile>`/`<Donut>`.
- Blocked on [M27](./M27-speakers-admin.md)'s deep-link targets: link to the un-filtered list; add the query param later — but use the frozen `SPEAKERS_DEEPLINK_PARAMS` names when you do, never an invented `?filter=`.
- Ahead of schedule: start [M40](./M40-public-api.md) (Monday PM per PLAN §7 — `/stats` is a thin wrapper over `getOverview`, and the three unkeyed endpoints only need [M32](./M32-public-schedule-gallery.md)'s contracts which landed Sunday), or write the `docs/demo-script.md` paragraph for brief feature #6, or add the dashboard's 60-second walkthrough line for the judge.
