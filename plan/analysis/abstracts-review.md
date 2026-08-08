# Feature Analysis: Abstracts — Submission Management, Evaluation, Scoring

Area: **Program > Abstracts** (submissions table, statuses, bulk/row actions, detail drawer, evaluation & scoring workflow, accept/reject/waitlist decisions, category routing).
Sources: hackathon brief (`/home/yi/Code/tmp/swyx-requirements/requirements.txt`) + 5 product screenshots. Brief context: "Submission evaluation and scoring workflows, including optional AI-assisted review across multiple rounds" is a primary feature, with swyx's inline note that AI-assisted review is "very optional, do if u feel like it". Custom CFP forms with **conditional logic and category-based routing** is a separate primary feature that feeds this area.

---

## What the screenshots show — per screenshot

### 1. `100002010000080000000580036F4AE9BCEC7B11.png` — Abstracts list (default view)

- **Top chrome**: global "Find or ask" search bar (⌘K shortcut hint), "View Portal" button, notifications megaphone icon (with red unread dot), help icon, user avatar ("SY").
- **Left nav**: event switcher card "AI.Engineer Sand… / Oct 12–14, 2026" (with up/down chevron implying multi-event switching); **Dashboard**; **Program** (expanded) containing:
  - **Overview**
  - **SUBMISSIONS** section: **View All**, **Abstracts** (active/highlighted), **Sessions**, **Files**
  - **COLLECT & REVIEW** section: **Forms**, **Evaluation**, **Agenda**, **Invoices**, **Site**
  - **PORTALS** section: **Portals**, **Tasks**, **Forms**, **File Requests**, **Resources**, **Files**
  - **CONFIGURE** section: **Settings**
  - **CRM** (collapsed, chevron)
- **Page header**: scroll icon + title "Abstracts", subtitle "Review and manage your abstract submissions". Right side: "… Options" button and primary "+ Add Abstract" button.
- **Status tabs with live counts** (this is the canonical status/lifecycle rail): **All Abstracts (2)** — active, **Accepted (0)**, **Accept Queue (0)**, **Pending (2)**, **Decline Queue (0)**, **Declined (0)**, **Withdrawn (0)**, **Drafts (0)**.
- **Table toolbar**: "Search abstracts…" input; a row-density/format icon button; **Saved Views** dropdown (eye icon); **Columns** button (highlighted/toggled); **Sort** button; **Filter** button.
- **Table columns visible**: leading select-all checkbox, per-row checkbox, per-row **pencil (edit) icon**, **Status** (badge, e.g. yellow "Pending"), **Source** (badge "Session Submission F…" — i.e. which submission form produced this abstract), **Title** ("sd", ";lkj"), **Client Session ID** ("-"), **Description** ("wdw", "lkjasd"), **Notified** ("-"), **Rating** (truncated at right edge — a ratings/score column exists). Every column header has an info "ⓘ" tooltip icon. Table scrolls horizontally (more columns off-screen; see screenshot 3/4).
- **Footer**: "1 — 2 of 2 rows", pager (prev / page 1 / next), "Show: 25" page-size selector.

### 2. `100002010000080000000589D855968A30B60D54.png` — Inline status editor (popover)

- Same page; the **Pending** status badge on row 1 has been clicked, opening a **Status popover** with header "Status" and an "✕ Clear" action.
- Selectable status options rendered as colored pills: **Accepted** (green), **Accept Queue** (light green), **Pending** (yellow, currently checked ✓), **Decline Queue** (amber/dark yellow), **Declined** (red). Below the list, the current selection is shown as a removable chip ("Pending ✕"). Footer buttons: **Cancel** / **Save**.
- Key inferences: status is inline-editable per row from the table; a **single-select** with explicit save; the editable set excludes Withdrawn/Drafts (Withdrawn is speaker-initiated, Drafts is an incomplete-submission state, so organizers manually move between the 5 decision states only).
- Confirms color semantics: green=accepted family, yellow=pending family, red=declined.

### 3. `100002010000080000000586D146B9DDA059D618.png` — "Preferences" panel (Columns / Sort / Filter / Drafts)

- Right-hand slide-over titled **Preferences** with ✕ close and tabs: **Columns (18/25)** — active, **Sort**, **Filter**, **Drafts**.
- Sub-tabs: **Fields** (active) / **Reporting Fields**. "Search columns…" input.
- Field group header: **SESSION DETAILS (18/39)** with **Show All** / **Hide All** actions — i.e. ~39 available fields on a session/abstract record, 18 selected.
- Left list = available fields with checkbox + type icon + declared type:
  - **Capacity** — Number (checked)
  - **CEU Credits** — Number (checked)
  - **Chairperson** — Text (unchecked)
  - **Client Session ID** — Text (checked)
  - **Created At** — Date (unchecked)
  - **Description** — Rich Text (checked)
  - **Ends At** — Date (unchecked)
  - **Exhibitors** — Text (unchecked)
  - **Files** — Text (checked)
  - (each row also has a small calendar-like icon on the right)
- Right list = **Selected (18)** with "Drag to reorder columns" hint, drag handles, and per-item ✕ remove; **Reset to Default** action. Selected order visible: **Client Session ID, Description, Notified, Ratings: My Evaluation Plan, Format, Language, Level, Session Submitter, Speaker, Track, Tags, Files, Location, CEU Credits** (list continues below fold).
- Footer: **Apply Changes** button.
- Key inferences: the abstract/session record carries fields — **Notified** (date-ish), **Ratings: My Evaluation Plan** (numeric — scores are surfaced per *evaluation plan*, implying a named evaluation-plan entity whose aggregate rating is a table column), **Format** (enum/dropdown), **Language** (enum), **Level** (enum), **Session Submitter** (text/person), **Speaker** (person(s)), **Track** (enum), **Tags** (multi), **Location** (enum/room), plus Capacity, CEU Credits, Chairperson, Exhibitors, Created At, Starts/Ends At. Sort and Filter live in the same panel; per-user column sets and "Saved Views" persist configurations. "Drafts" tab in Preferences suggests saved in-progress view configs (or draft filters).

### 4. `10000201000008000000057FB56D054E0D3E1AD7.png` — Options menu + horizontally scrolled table

- The "… Options" menu is open (red arrow annotation from the brief author points at it): **Import Sessions**, **Export .CSV**, **Export .XLSX**, **Download files bundle…**.
- The table is scrolled right revealing more columns: **…itter** (= Session Submitter, showing emails "@ai.en…"), **Speaker** (chips: "qwd qdw", "wad wdq" — multiple speaker chips per row), **Track** (colored chips: green "Track 2", blue "Track 1" — per-track colors), **Tags** (chip "Tag A"), **Files** ("-"), **Loca…** (Location, "-"), **Capacity** ("-"), and another truncated column.
- Same tabs/counts, footer pager as screenshot 1.
- Key inferences: bulk data in/out is first-class (CSV/XLSX export, session import, zip of all submitted files). Multi-speaker per abstract. Track/Tags are colored chips (Track appears single-value; Tags multi-value).

### 5. `10000201000008000000057029CEE17389556640.png` — "Add Abstract" drawer (organizer-side manual create)

- Right-hand drawer titled **Add Abstract**, ✕ close. Two tabs: **Details** (active) and **Participants** (people icon) — abstract participants/speakers are managed on a separate tab of the same record.
- Details form fields, in order: **Title\*** (required, placeholder "Enter abstract title…", **0/255 char counter**), **Status** (dropdown, defaulting to yellow "Pending" badge), **Description** (rich-text area, "Enter description…"), **Starts At** ("Select start date & time…"), **Ends At** ("Select end date & time…"), **Capacity** ("Number of attendees"), **CEU Credits** ("Enter CEU credits"), **Client ID** ("Enter client ID"), **Format** ("Select format…" dropdown) — list continues below fold (Language, Level, Track, Tags, Location per screenshot 3's field list).
- Footer: **Cancel** / **Create Abstract** (primary).
- Key inferences: organizers can create abstracts manually (bypassing the public CFP form → "Source" would differ from "Session Submission Form"); status is settable at creation; the abstract record doubles as a proto-session (start/end/location/capacity) which is why acceptance can flow into Sessions/Agenda.

### Not shown in these 5 screenshots (inferred from nav + brief)

- The **Evaluation** nav item (Collect & Review section) is where evaluation plans / reviewer assignment / scoring live — no screenshot of its internals was provided, so the clone has latitude in its design. The "Ratings: My Evaluation Plan" column plus the "Rating" table column and the brief's "evaluation and scoring workflows … across multiple rounds" define the requirement.
- The **Notified** column implies a decision-notification step (accept/decline emails) that stamps a notified date — this bridges to the communications feature area.
- **Accept Queue / Decline Queue** statuses are staging states: mark decisions in bulk, then notify later (batch), moving Accept Queue → Accepted and Decline Queue → Declined at notification time.

### Inferred submission lifecycle (canonical state machine)

```
Draft ──(speaker completes form)──▶ Pending ──▶ Accept Queue ──(notify)──▶ Accepted ──▶ (promoted to Session / Agenda)
                                      │
                                      ├──▶ Decline Queue ──(notify)──▶ Declined
                                      └──(speaker withdraws, any pre-decision state)──▶ Withdrawn
```
- `Draft`: partially-completed CFP submission (speaker started, not submitted).
- `Pending`: submitted, awaiting review — the default status on create.
- `Accept Queue` / `Decline Queue`: organizer decision staged, speaker not yet notified.
- `Accepted` / `Declined`: final, speaker notified (Notified timestamp set).
- `Withdrawn`: speaker-initiated retraction.
- Organizer can also set any of the 5 decision states directly via the inline editor (skipping queues).

---

## Required capabilities

1. **[CORE] Submissions table** at Program > Abstracts listing all abstracts for the current event with columns: Status, Source (originating form), Title, Description, Submitter, Speaker(s), Track, Tags, Rating (avg score), Notified date, plus Format/Language/Level/Location/Capacity as configurable extras.
2. **[CORE] Status tabs with counts** across the top: All, Accepted, Accept Queue, Pending, Decline Queue, Declined, Withdrawn, Drafts — clicking a tab filters the table; counts always live.
3. **[CORE] Full lifecycle state machine** implementing the 8 states above with legal transitions (Draft→Pending on submit; Pending→queues/direct decisions; queue→final on notify; →Withdrawn by speaker) enforced server-side.
4. **[CORE] Inline status editing** — click a row's status badge, pick a new status from the 5 decision states, Save/Cancel. (Clone may simplify to a plain select.)
5. **[CORE] Accept / Reject decision workflow** — per-row and **bulk** (checkbox selection → bulk status change). Accept Queue/Decline Queue serve as the "waitlist/staging" mechanic; a distinct "Waitlisted" state is not in the screenshots and is not required.
6. **[CORE] Decision notification** — action ("Notify") that sends templated accept/decline email to the submitter/speakers, stamps `notified_at`, and flips queue states to final. (Email templates belong to the communications module; this module triggers them and records the stamp.)
7. **[CORE] Search** over title/description/submitter (the "Search abstracts…" box).
8. **[CORE] Filter** by status, track, tags, format, rating range, source form; **Sort** by any visible column.
9. **[CORE] Submission detail view** (drawer or page) with Details tab (all fields, rich-text description) and Participants tab (linked speakers with roles); editable by organizer.
10. **[CORE] Organizer manual "Add Abstract"** with required Title (255-char max), default status Pending, and the field set from screenshot 5.
11. **[CORE] Intake from CFP forms** — public form submissions create abstracts with `source = <form name>`, status Pending (or Draft if incomplete), category/track captured from form answers. (Form builder itself is another module; this module owns the abstract record it creates.)
12. **[CORE] Category-based routing** — abstracts carry a category/track; evaluation assignments can be scoped so reviewers see only abstracts in their assigned categories/tracks. (Brief: "category-based routing" under CFP forms.)
13. **[CORE] Evaluation plans & scoring** — organizer defines an evaluation plan (name, score scale e.g. 1–5, optional multiple criteria, assigned reviewers, optional category scope); reviewers score assigned abstracts; table shows aggregate rating and "Ratings: <plan name>" per plan. Support ≥1 sequential **rounds** (plan has a round number; round N can be limited to survivors of round N−1) — brief says "across multiple rounds".
14. **[CORE] Reviewer view** — a reviewer-facing queue listing assigned abstracts with score entry (per-criterion or single score + comment), showing review progress (n of m scored). Blind-review option is [NICE].
15. **[CORE] Accepted → Session promotion** — accepted abstracts become (or link to) Session records usable by the Agenda builder (they already carry starts/ends/location/capacity/track fields).
16. **[NICE] Column preferences panel** — show/hide from the full field list, drag-to-reorder, Reset to Default, persisted per user. (Minimum viable: fixed sensible column set + a simple show/hide.)
17. **[NICE] Saved Views** — named saved combinations of columns/sort/filter.
18. **[NICE] Export .CSV / .XLSX** of the (filtered) table. CSV is cheap and pairs naturally with the Airtable-export bonus; XLSX optional.
19. **[NICE] Import Sessions** (CSV import creating abstracts/sessions in bulk).
20. **[NICE] Download files bundle** — zip of all uploaded files across submissions.
21. **[NICE] AI-assisted review** — brief explicitly marks "very optional": e.g. an LLM pre-score/summary per abstract stored as a synthetic reviewer's score with rationale. Do only if time remains.
22. **[NICE] Per-column info tooltips, char counters, row-density toggle, ⌘K global search** — cosmetic parity items.
23. **[NICE] Public API** endpoints for abstracts list/detail (bonus points for API; Sessionboard has a public API at sessionboard.mintlify.app).

## Data entities

- **Event** — id, name, slug, start/end dates. Everything below is event-scoped.
- **Abstract (Submission)** — id, event_id, title (≤255), description (rich text), status enum (`draft | pending | accept_queue | accepted | decline_queue | declined | withdrawn`), source (`form:<id>` | `manual` | `import`), submission_form_id nullable, client_session_id (external ref), format, language, level, track_id, tags[], location/room nullable, capacity int, ceu_credits, starts_at/ends_at nullable, notified_at nullable, submitter_id, created_at/updated_at, custom_answers jsonb (CFP form responses).
- **AbstractSpeaker (Participant)** — abstract_id ↔ person_id, role (speaker/chairperson/etc.), ordering. Many-to-many: an abstract has multiple speakers; a person can be on multiple abstracts.
- **Person (Speaker/Submitter)** — id, name, email, bio, headshot, company/title; shared with portal & CRM modules.
- **Track / Category** — id, event_id, name, color; used for table chips, filtering, agenda, and reviewer routing.
- **Tag** — id, event_id, name; many-to-many with abstracts.
- **EvaluationPlan** — id, event_id, name, round number, score scale (min/max), status (open/closed), optional category/track scope, optional advancing-set source (previous plan).
- **EvaluationCriterion** — plan_id, label, weight (optional; single implicit criterion is acceptable).
- **ReviewerAssignment** — plan_id, reviewer_user_id, optional track/category scope (implements category routing) or explicit abstract list.
- **Score (Review)** — plan_id, abstract_id, reviewer_id, criterion scores, overall numeric, comment, submitted_at; unique (plan, abstract, reviewer). Aggregate avg surfaced as the table's Rating / "Ratings: <plan>" columns.
- **File / Attachment** — abstract_id, uploader, filename, url, size; feeds "Files" column and "Download files bundle".
- **User (Organizer/Reviewer)** — id, email, role per event (admin/organizer/reviewer).
- **SavedView** (nice) — user_id, event_id, page, name, config jsonb (columns/order/sort/filters).
- **NotificationLog** — abstract_id, template, sent_at, recipient; backs the Notified column.

Airtable export targets: Abstracts (flattened with speaker names, track, status, avg rating), People, Sessions — one-way push from Postgres.

## User flows

**Speaker (public visitor → speaker)**
1. Opens public CFP URL → fills submission form (fields per form builder, conditional logic) → may save partway (**Draft**) → submits → abstract created as **Pending**, source = form name; confirmation email.
2. Later, in speaker portal: sees submission status; can edit until review starts (clone choice); can **Withdraw** (status → Withdrawn).
3. On decision notification: receives accept/decline email; if accepted, portal unlocks onboarding tasks (other module).

**Organizer**
1. Opens Program > Abstracts → sees tabs with counts → clicks Pending.
2. Searches/filters (e.g. Track = "Track 1"), sorts by Rating desc.
3. Opens a row (pencil/click) → reads description, speakers, files, per-plan scores/comments.
4. Sets decision: inline status → Accept Queue (or bulk-selects 10 rows → bulk status change).
5. When ready, triggers Notify on Accept Queue/Decline Queue → templated emails go out, `notified_at` stamped, statuses finalize to Accepted/Declined.
6. Accepted abstracts appear in Sessions/Agenda for scheduling.
7. Housekeeping: Add Abstract manually (invited keynote), Import CSV, Export CSV/XLSX, Download files bundle, adjust columns/saved views.

**Organizer (evaluation setup)**
1. Program > Evaluation → create plan "Round 1", scale 1–5, criteria (e.g. Relevance, Quality), assign reviewers, scope reviewer A to Track 1 and reviewer B to Track 2 (category routing).
2. Monitors progress (x of y abstracts scored per reviewer); closes round; optionally creates "Round 2" over top-N.
3. Uses aggregated Rating column to drive accept/decline.

**Reviewer**
1. Logs in → sees assigned queue for open plans (only abstracts in their categories).
2. Opens abstract → reads (optionally blinded) content → enters criterion scores + comment → submits → next.
3. Can revise until plan closes; progress indicator updates.

**Public visitor** — no access to Abstracts admin; interacts only via the CFP form (above) and the public speaker gallery/schedule (other module) which consumes **Accepted** abstracts only.

## Edge cases & bug traps

1. **Status-tab counts vs. filtered table drift** — counts must come from the same source of truth as the list query (single grouped count query; invalidate TanStack Query caches for both list and counts on any status mutation, including bulk).
2. **Bulk actions across pagination/filters** — "select all" must be explicit about scope (current page vs. all matching). Simplest safe choice: selection is page-local; never silently mutate unseen rows.
3. **Concurrent edits** — two organizers editing the same abstract status simultaneously; use `updated_at` optimistic-concurrency check or last-write-wins with a refetch; never let a stale drawer Save resurrect old status after a bulk change.
4. **Notify idempotency** — double-clicking Notify or two admins notifying the same queue must not double-send email. Guard with `notified_at IS NULL` conditional update in one transaction per abstract; log sends.
5. **Illegal transitions** — server must reject e.g. Withdrawn→Accepted or scoring a Draft; don't rely on UI hiding options. Speaker withdrawal after Accept Queue must cancel pending notification.
6. **Draft submissions** — partial CFP data means nullable everything except title-or-placeholder; the table and detail view must not crash on null description/track/speakers (screenshots show "-" placeholders everywhere — render "-" not "undefined").
7. **Empty states** — every tab with 0 rows, table with 0 total abstracts, reviewer with 0 assignments, plan with 0 criteria; all need designed empty states.
8. **Score aggregation** — avg must ignore missing reviews (not treat as 0); an abstract with no scores shows "-" and must sort deterministically (nulls last regardless of asc/desc). Per-plan columns need per-plan aggregates, not a global avg.
9. **Duplicate review protection** — unique constraint (plan, abstract, reviewer) + upsert semantics; reviewer resubmitting must update not duplicate.
10. **Reviewer scope changes mid-round** — reassigning categories after scores exist: keep existing scores, just change future visibility; never cascade-delete scores.
11. **Timezones** — event is Oct 12–14 with starts_at/ends_at on abstracts: store UTC (timestamptz), render in the **event's** timezone (not the viewer's) for schedule-ish fields; `notified_at`/`created_at` can render in viewer-local. Never store naive local datetimes.
12. **Rich text description** — sanitize HTML on input (XSS via CFP form is attacker-controlled public input rendered in the admin panel — a real stored-XSS vector); truncate safely in table cells.
13. **255-char title limit** — enforce in DB and API, not only the counter UI; imported/CSV rows may exceed it.
14. **CSV import/export gotchas** — commas/quotes/newlines in descriptions, multi-speaker flattening (join with ";"), status values outside the enum on import (reject row with error report, not crash).
15. **Multi-speaker ordering & orphaned people** — deleting an abstract shouldn't delete shared Person rows; deleting a person referenced by abstracts needs restriction or soft delete.
16. **Withdrawn/declined leakage** — public gallery/schedule and Airtable export of "sessions" must filter to Accepted only; queue states are internal and must never appear speaker-side (speaker sees "Pending" until notified — do not expose Accept Queue to portal).
17. **Pagination + inline edit** — after a status change the row may no longer match the active tab's filter; decide (and test) whether it disappears immediately (recommended) without breaking pager counts.
18. **Airtable export drift** — one-way sync must be idempotent (upsert on stable external id) and tolerate Airtable rate limits (batch of 10/req); never block the user-facing request path on it.
19. **Neon/serverless Postgres on Workers** — connection handling via HTTP driver (`@neondatabase/serverless`) or pooled connections; avoid long transactions in bulk notify; watch cold-start latency for the "speed" bonus.
20. **Client Session ID uniqueness** — it's an external correlation id; treat as free text, not unique, not required.

## Simplifications

1. **Merge Rating into one aggregate** — support multiple evaluation plans in the schema but ship the UI with one visible "Rating" (avg of active plan) column; per-plan columns only if time permits. Rounds = ordered plans; no auto-advancement logic (organizer filters by rating and bulk-moves manually).
2. **Fixed, sensible column set** with a lightweight show/hide checklist instead of the full drag-reorder Preferences panel with 39 fields and Reporting Fields. Skip per-user persistence beyond localStorage/Zustand.
3. **Skip Saved Views** (or localStorage-only), skip row-density toggle, skip ⌘K global "Find or ask".
4. **Skip fields with no demo value**: CEU Credits, Exhibitors, Chairperson, Client Session ID, Invoices. Keep Format/Language/Level as simple selects only if the CFP form module wants them; Track + Tags are the ones that matter (routing, agenda, gallery).
5. **Status popover → plain shadcn Select** on the badge; identical semantics, far less UI work. Keep the colored badge rendering (green/yellow/red) for scannability.
6. **Queues as statuses, not separate machinery** — Accept Queue/Decline Queue are just enum values plus one "Send notifications" bulk action; no scheduling engine needed.
7. **CSV only** (skip XLSX); "Download files bundle" only if file uploads land in scope, else omit.
8. **Import Sessions**: skip, or accept a rigid CSV template with a strict column order.
9. **Reviewer experience as a filtered route** (`/review`) reusing the same table components with score-entry drawer — not a separate app. Single score (1–5) + comment is enough; multi-criteria only if trivial with the schema already supporting it.
10. **AI-assisted review**: implement, if at all, as one authenticated "Generate AI review" route writing a Review row from a synthetic "AI Reviewer" with the model's rationale as the comment — no pipelines, no auto-runs.
11. **Detail view = right-hand drawer** (shadcn Sheet) matching screenshots, with Details/Participants tabs; no separate full page.
12. **Withdrawn**: a speaker-portal button + status; no re-instate flow (organizer can manually flip status if needed).
13. **Notified**: single timestamp + one templated email per decision; no per-channel tracking. Calendar invites belong to the communications module post-acceptance, not here.
14. **Typed contract for parallel agents**: define the status enum, Abstract DTO, and transition function in a shared `packages/`-style module (e.g. `features/abstracts/contracts.ts` with zod schemas) consumed by table UI, CFP intake, portal, agenda, and Airtable export — this is the highest-leverage boundary since 4+ other modules read abstract state.
