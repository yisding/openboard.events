# Feature Analysis: Dashboard + Automated Speaker Communications

Area owner analysis for the Sessionboard-clone hackathon (AI Engineer, deadline Wed Aug 12 2026 10PM PT).
Brief status of this area:

- **Dashboard** — brief line: "Real-time dashboard showing which speakers still have outstanding onboarding tasks." The requirements file labels the Dashboard screenshots "optional but nice to have, best efforts", but the outstanding-onboarding-tasks view itself is listed among the primary features. Treat "which speakers still have outstanding tasks" as [CORE] and the rest of the dashboard chrome as [NICE].
- **Communications** — brief line: "Automated, templated speaker communications, including reminders and calendar invites delivered directly to each speaker's own calendar (Gmail, Outlook, iCal)." This is unambiguously [CORE]. There are no screenshots of Sessionboard's comms UI, so the spec below is derived from the brief plus what the rest of the product implies (statuses, tasks, portal invites). swyx's margin note: "Cloudflare has workflows for scheduling, the email part also but you are welcome to use Resend or something else if you prefer that."

---

## What the screenshots show — per screenshot

### 1000020100000800000005946F9B3B54B22A7269.png — Dashboard, "Today" tab (top half)

- **Global chrome**: top search bar "Find or ask" with ⌘K shortcut hint; top-right "View Portal" button, megaphone/announcements icon with red unread dot, help "?" icon, user avatar "SY".
- **Left sidebar (event-scoped nav)**: event switcher card "AI.Engineer Sand… / Oct 12–14, 2026" with an org/event switch chevron; then: **Dashboard** (active, highlighted); **Program** (collapsible) containing: Overview; section header SUBMISSIONS → View All, Abstracts, Sessions, Files; section header COLLECT & REVIEW → Forms, Evaluation, Agenda, Invoices, Site; section header PORTALS → Portals, Tasks, Forms, File Requests, Resources, Files; section header CONFIGURE → Settings; bottom item **CRM** with expand chevron.
- **Page header**: kicker "SATURDAY, AUGUST 8 · 65 DAYS TO EVENT"; greeting "Good morning, Sw" (first name of logged-in organizer).
- **Dashboard tab bar**: four dashboards, each with a colored bullet: **Today** (active, blue), Review Progress (orange), Speaker Tracking (blue), Submissions Pipeline (purple). Right side: "+ Add Dashboard" button.
- **Top KPI cards (4)**: Submissions **4** (doc icon), Accepted Speakers **2** (mic icon), Exhibitors **0** (booth icon), Sponsors **0** (award icon).
- **SUBMISSION STATUS card row (5)**: Accepted **1** (check icon), Pending **3** (clock icon + info tooltip "ⓘ" on label), Declined **0** (x icon), Drafts **0** (draft icon), Withdrawn **0** (exit icon). These are the five submission statuses the whole product uses.
- **"Also check" attention strip**: inline actionable alerts with deep links: "1 accepted sessions still need a time slot on the agenda. (Agenda) →" · "3 session submissions are awaiting a decision. (Participants) →" · "+1 more" overflow.
- **Secondary tab bar within Today**: Submission Forms (active) | Participants | Evaluations | Agenda.
- **"Submission Pacing" panel** (collapsible via chevron): subtitle "Cumulative submissions in the run-up to event start." Stat tiles: Submissions **4**; "vs prior (T-65d)" **— —** (no prior event); "Days to event" **65**; "This week vs prior" **+4**. Chart area: legend "— This event", toggle buttons **Days before event** (active) / **Calendar date**, y-axis 0–4, cumulative line chart.

### 100002010000080000000574039D287BA4CC760D.png — Dashboard, "Today" tab (scrolled down)

- **Submission Pacing chart footer**: x-axis ticks T-365d, T-290d, T-215d, T-140d, T-65d; helper text "Pick a prior event to compare submission pacing edition-over-edition."
- **"Your forms" section**, right link "View 1 more": overall "SUBMISSION PROGRESS" green progress bar with "**2** submitted"; then one card per submission form: "Session Submission Form #2" [Open badge, green] — progress bar, "1 submitted", buttons **View** (external-link icon) and **Manage** (gear); "Session Submission Form #3" [Open] — "Closes in a month", progress bar, "1 submitted", View/Manage; "Session Submission Form #4" [Open] — "No submissions yet", View/Manage. So form cards show status badge (Open/Closed), close-date countdown, per-form submission count, and links to the public form and its admin page.
- **"Recent Submissions" table**, right link "View all". Columns: **Source** (originating form name or "Manual"), **Title**, **Status** (badges: Accepted = solid dark, Pending = gray), **Speakers** (em-dash when none linked), **Tags** (circled chips, e.g. "Tag A"), **Submitted** (full timestamp w/ timezone, e.g. "Fri August 7, 2026, 11:51:05 PM PDT"). Rows shown: "sd" (Form #3, Accepted, Tag A), ";lkj" (Form #2, Pending, Tag A), "AIE Presenting Expo 1" (Manual, Pending, no tag), "AIE NYC 2026: Insights from Session T…" (Manual, Pending, Tag A, truncated title).

### 100002010000080000000584EC84517DA3F64852.png — Dashboard, "Today" → "Participants" sub-tab

- Same status card row visible at top (Accepted 1 / Pending 3 / Declined 0 / Drafts 0 / Withdrawn 0) and the "Also check" strip.
- Sidebar hover tooltip visible: "View all my organizations" on the logo — implies multi-org hierarchy above events.
- Secondary tab bar with **Participants** active.
- **Two attention banners with CTA links**: "ⓘ 3 session submissions are awaiting a decision." → link "Review submissions"; "ⓘ 2 accepted speakers are missing a bio or headshot (2 bios, 2 headshots)." → link "View speakers". This second banner is the key "outstanding onboarding" signal: the dashboard computes missing-profile-field counts per accepted speaker.
- **"Program snapshot"** section, right link "View participants":
  - **PARTICIPANTS BY ROLE** widget. Explainer text: "Role names (e.g. Speakers, Unconfirmed Speakers) come from this event's participant role settings. Each row is unique people in that role on a submission. The center total deduplicates people in multiple roles." Big number **6 unique participants**; horizontal 100% stacked bar; row "● Speakers — 6 — 100% →" (drill-in chevron). Implies configurable participant roles per event and dedup logic.
  - **SUBMISSION STATUS** widget. Explainer: "Counts session submissions (not people), at top level only." Donut chart, center "**3** awaiting decision"; legend rows with counts, %, drill-in chevrons: Accepted abstracts 1 (20%), Accepted sessions 1 (20%), Pending abstracts 1 (20%), Pending sessions 2 (40%). Implies two submission kinds (abstract vs session) × status.

### 100002010000080000000595022D50F707F65FBA.png — Dashboard, "Today" → "Evaluations" sub-tab

- Browser URL visible: `appv2.sessionboard.com/event/6703/dashboard/evaluations` — dashboards are per-event and each sub-tab has its own route (deep-linkable).
- Same header, KPI row, status row, "Also check" strip.
- **"Review progress"** panel (yellow-tinted border), right link "Open evaluation": empty-state box "Reviewer assignments will appear here once evaluations begin."; stat tiles: **Evaluation 2.0 plans: 1**, **Evaluated submissions: 0**, **Reviews in progress: 0**; footer "Most active plan: My Evaluation Plan".

### 10000201000008000000057DBCD9D6D495E125E6.png — Dashboard, "Speaker Tracking" tab (custom dashboard)

- Tab bar with **Speaker Tracking** active. Label under tabs: "● CUSTOM DASHBOARD" with description "Confirmation status, outstanding tasks, and an overdue list for accepted speakers." Right buttons: **+ Add Widget**, **Settings** (gear).
- Widgets: big-number tile **0 ACCEPTED SPEAKERS**; big-number tile **0 OUTSTANDING SPEAKER TASKS**; **SPEAKER CONFIRMATION MIX** panel (chart, empty → "No data"); **TOP SPEAKERS BY OUTSTANDING TASKS** panel (ranked bar list, empty → "No data").
- This tab IS the brief's "real-time dashboard showing which speakers still have outstanding onboarding tasks": count of open tasks, per-speaker ranked list, confirmation-status mix, and (per description) an overdue list.
- Note: it renders "No data"/0 even though 2 speakers are accepted elsewhere — likely because tasks/confirmations haven't been assigned in the sandbox. Clean empty states everywhere.

### 1000020100000800000005899C0A3E6849F43662.png — Dashboard, "Submissions Pipeline" tab (custom dashboard)

- **Submissions Pipeline** tab active; "● CUSTOM DASHBOARD" label with description "Funnel of submissions from received → reviewed → accepted, with per-form and per-track context." Buttons: + Add Widget, Settings.
- Widgets: big-number **2 TOTAL SUBMISSIONS**; big-number **2 PENDING REVIEW**; **SUBMISSIONS BY FORM** vertical bar chart (y 0–2; single bar value 2 labeled "(none)" — bucket for submissions with no form, i.e. manual ones); **SUBMISSIONS BY TRACK** vertical bar chart (y 0–1, two bars of 1).
- Note: counts here (2) differ from the Today tab (4) — different widget filters (e.g. excluding drafts or one form). A clone with one consistent counting rule is fine.

### 100002010000080000000574D408B9E51F311979.png — "New Dashboard" modal (Add Dashboard flow)

- Modal title "New Dashboard", subtitle "Start from a pre-built dashboard, describe what you want, or build one manually." Close ×.
- **Three creation modes** (segmented control): **Gallery** (active), **AI prompt** (sparkle icon — natural-language dashboard generation), **Build manually** (wrench icon).
- **Gallery of pre-built dashboard templates**, each card = preview image + name + description + category chip + widget count:
  1. **Event Overview** — "KPIs at a glance: total submissions, accepted speakers, scheduled sessions, and session…" [OVERVIEW, 5 widgets]. Preview shows tiles Submissions 248 / Speakers 86 / Scheduled 142 / Draft 12, "Sessions by Day" bar chart, "Status Mix" donut (Accepted/Pending/Other).
  2. **Submissions Pipeline** — "Funnel of submissions from received → reviewed → accepted, with per-form and…" [SUBMISSIONS, 5 widgets].
  3. **Speaker Tracking** — "Confirmation status, outstanding tasks, and an overdue list for accepted speakers." [SPEAKERS, 5 widgets]. Preview: Accepted Speakers 86 / Outstanding Tasks 42, "Confirmation Mix" donut (68% center), "Top Open Tasks" per-person bar list (A. Chen, M. Patel, J. Rivera, S. Park, L. Wang, T. Brown).
  4. **Review Progress** — "Reviewer workload, session scores, top-rated sessions, and pending submissions." [EVALUATION, 5 widgets].
  5. **Evaluation Plans by Tracks** — "Compare Plan 2.0 session scores across tracks and evaluation plans." [EVALUATION, 4 widgets].
  6. **Schedule Health** — "Scheduled vs unscheduled sessions, sessions per day/room/track, and an…" [AGENDA, 5 widgets]. Preview: Scheduled 142 / Unscheduled 28, "Sessions per Day" bars (Mon–Fri), "Sessions per Room" bar list (Main, Hall A, Hall B, Studio, Pavilion, Lounge).
  7. Two more template cards partially visible below (green and orange tints), names cut off.

**No screenshot shows the communications UI** (email templates, sends, or calendar invites) — that requirement is specified from the brief text alone.

---

## Required capabilities

Numbered functional requirements for a good-enough clone. [CORE] = in the brief's primary features; [NICE] = visible in screenshots or optional in the brief.

### A. Dashboard

1. [CORE] **Outstanding-onboarding view**: a per-event dashboard page that shows, in near-real-time (fresh on load + TanStack Query refetch; no websockets needed), which accepted speakers still have outstanding onboarding tasks: total open-task count, ranked "top speakers by outstanding tasks" list (speaker name → count of incomplete tasks, click-through to that speaker), and an overdue list (tasks past due date).
2. [CORE] **Missing-asset detection**: computed alerts for accepted speakers missing required profile assets (bio, headshot), with counts per asset type and a link to the filtered speaker list (mirrors "2 accepted speakers are missing a bio or headshot (2 bios, 2 headshots)").
3. [NICE] **KPI tiles**: Submissions, Accepted Speakers (Exhibitors/Sponsors can be dropped), plus submission-status tiles Accepted / Pending / Declined / Drafts / Withdrawn — one COUNT query grouped by status.
4. [NICE] **"Also check" attention strip**: rule-driven alerts with deep links, at minimum: accepted sessions with no agenda slot → Agenda; submissions awaiting decision → review queue; speakers missing bio/headshot → speakers list.
5. [NICE] **Speaker confirmation mix**: donut/stat of accepted speakers by confirmation status (confirmed / unconfirmed / declined).
6. [NICE] **Submissions pipeline widgets**: total submissions, pending review, submissions-by-form bar chart (with "(none)" bucket for manual submissions), submissions-by-track bar chart.
7. [NICE] **Review-progress widget**: evaluated count, in-progress count, empty state "Reviewer assignments will appear here once evaluations begin." (Depends on the evaluation module's data; render from a typed read-model it exposes.)
8. [NICE] **Recent submissions table**: Source / Title / Status / Speakers / Tags / Submitted-timestamp, newest first, "View all" link into the submissions module.
9. [NICE] **Form progress cards**: per submission form — status badge (Open/Closed), closes-in countdown, submissions count, View (public URL) and Manage links.
10. [NICE→SKIP] Custom dashboard builder (Add Dashboard / Add Widget / AI prompt / gallery), submission-pacing chart vs prior editions, multi-dashboard tabs. Ship 1–2 fixed dashboards instead (see Simplifications); a fixed "Speaker Tracking" page satisfies the CORE line.
11. [NICE] **Greeting/header**: date, days-to-event countdown, "Good morning, {firstName}". Trivial and makes the clone feel like the real product in judging.

### B. Automated speaker communications

12. [CORE] **Email templates**: organizer-editable templates per event with a template-variable system. Minimum template set: (a) submission received, (b) submission accepted / invitation to portal, (c) submission declined, (d) task assigned, (e) task reminder / overdue nudge, (f) schedule-assignment notice with calendar invite, (g) schedule-change notice with updated invite. Variables (interpolated server-side, HTML-escaped): `{{speaker.first_name}}`, `{{speaker.last_name}}`, `{{speaker.email}}`, `{{event.name}}`, `{{event.start_date}}`, `{{event.venue}}`, `{{submission.title}}`, `{{session.title}}`, `{{session.start_time_local}}`, `{{session.end_time_local}}`, `{{session.timezone}}`, `{{session.room}}`, `{{session.track}}`, `{{task.name}}`, `{{task.due_date}}`, `{{tasks.outstanding_list}}` (rendered bullet list), `{{portal.magic_link}}`, `{{unsubscribe.url}}`. Unknown variables must fail validation at template-save time, not at send time.
13. [CORE] **Trigger points (automated sends)**: on submission received → (a); on status change to Accepted → (b); to Declined → (c); on task assigned → (d); on schedule slot assigned/changed for a speaker's session → (f)/(g). Triggers fire from domain events, not from UI code paths, so manual admin edits also trigger them. Per-event toggle to enable/disable each automation.
14. [CORE] **Reminder scheduling**: scheduled reminder emails for incomplete tasks — configurable offsets (e.g. 7 days before due, 1 day before due, on/after due date) with a default schedule; skip if the task is completed by send time (check at send time, not enqueue time). Implement on Cloudflare: Workflows with `step.sleep`/`sleepUntil`, or a Cron Trigger that scans for due reminders each run (simpler, idempotent — recommended).
15. [CORE] **Calendar invites to the speaker's own calendar (Gmail/Outlook/iCal)**: generate RFC 5545 **ICS** and deliver it as (a) a `text/calendar; method=REQUEST` attachment (`.ics`, `METHOD:REQUEST`, `ORGANIZER`, `ATTENDEE=speaker`) so Gmail/Outlook render an actual invite with RSVP, and (b) an HTTPS link to download the ICS from the portal. ICS must carry stable `UID` per speaker+session, incrementing `SEQUENCE` on every change, `DTSTART/DTEND` with event-timezone `VTIMEZONE` (or UTC `Z` form), `SUMMARY`, `LOCATION` (room + venue), `DESCRIPTION` (with portal link), `STATUS:CONFIRMED`, and `METHOD:CANCEL` when a session is unscheduled/declined. No OAuth into speakers' calendars — nothing in the brief or screenshots requires it.
16. [CORE] **Send pipeline**: outbound email uses the one Resend adapter; every send is **one** `communication_logs` outbox/audit row per natural key (recipient, template, queued/sent/failed/skipped status, provider id, attempts, timestamp), keyed by the seven shared natural-key builders. Retries re-use that row and increment `attempts` — they never insert a second row — so double-fired triggers cannot double-send.
17. [NICE] **Manual/bulk send**: organizer picks a template + audience segment (all accepted, unconfirmed, has-outstanding-tasks) → preview with variables resolved for one sample recipient → send; log each recipient.
18. [NICE] **Comms history per speaker**: timeline of what was sent to whom, surfaced on the speaker detail page from `communication_logs`.
19. [NICE] **Unsubscribe/suppression**: honor an `unsubscribed_at` flag for reminder-class mail (transactional accept/decline still sends); one-click link. Cheap and avoids embarrassing judges' inboxes.
20. [NICE] **Public API** (bonus points): read endpoints for dashboard stats (`GET /api/v1/events/:id/stats`), outstanding tasks (`GET /api/v1/events/:id/speakers/outstanding`), and comms log; token auth. Mirrors Sessionboard's public API bonus in the brief.
21. [NICE] **Airtable export**: include `speakers`, `submissions`, `tasks` (with completion status), and `communication_logs` in the one-way Airtable sync so this area contributes to the bonus.

---

## Data entities

(Names indicative; this area consumes most of them and owns the comms + dashboard read-model ones. Cross-module contracts marked ↔.)

- **Event** ↔ — id, org_id, name, slug, start_date, end_date, venue, **timezone (IANA)**, days_to_event (derived). Everything below is event-scoped.
- **Submission** ↔ — id, event_id, form_id (nullable → "Manual"/"(none)"), kind (`abstract` | `session`), title, status enum (`draft` | `pending` | `accepted` | `declined` | `withdrawn`), track_id (nullable), tags[], submitted_at (timestamptz), decided_at. Status transitions are the comms trigger source.
- **Speaker / Participant** ↔ — id, event_id, first_name, last_name, email (unique per event for dedup), bio (nullable), headshot_url (nullable), role (from event role settings; default `speaker`), confirmation_status (`unconfirmed` | `confirmed` | `declined`), portal magic-link token, unsubscribed_at (nullable).
- **SubmissionSpeaker** ↔ — join: submission_id, speaker_id, role; a person on multiple submissions is counted once ("deduplicates people in multiple roles").
- **Task** ↔ — id, event_id, name, description, due_at (timestamptz), required (bool), type (`form` | `file_request` | `simple`).
- **TaskAssignment** ↔ — task_id, speaker_id, status (`open` | `completed`), completed_at. `open AND now > due_at` ⇒ overdue. This is the row the CORE dashboard aggregates.
- **Session (scheduled)** ↔ — id, submission_id, title, room_id, track_id, starts_at, ends_at (timestamptz stored UTC, rendered in event tz), schedule_revision (int) → drives ICS `SEQUENCE`.
- **EmailTemplate** (owned) — id, event_id, key (the canonical eight-key enum: `submission_received` | `submission_accepted` | `submission_declined` | `task_assigned` | `task_reminder` | `schedule_assigned` | `schedule_changed` | `portal_login`), subject, body (markdown/HTML with `{{vars}}`), enabled (bool), updated_at.
- **ReminderRule** (owned) — id, event_id, template_key, offset (interval relative to task due date, e.g. `-P7D`, `-P1D`, `+P1D`), enabled.
- **CommunicationLog** (owned) — id, event_id, speaker_id, template_key, subject_rendered, status (`queued` | `sent` | `failed` | `skipped`), attempts (int), provider_message_id, idempotency_key (unique), ics_uid (nullable), sent_at.
- **CalendarInvite** (owned, or columns on log) — speaker_id, session_id, ics_uid (stable), sequence (int), last_method (`REQUEST` | `CANCEL`), last_sent_at.
- **DashboardSnapshot read-model** (owned, virtual — SQL views/queries, not tables): submission counts by status/form/track; accepted-speaker count; outstanding/overdue task counts per speaker; missing bio/headshot counts; confirmation mix; attention-strip rules.

Relationships: Event 1—* Submission, Speaker, Task, EmailTemplate, ReminderRule, CommunicationLog. Submission *—* Speaker (via SubmissionSpeaker). Task *—* Speaker (via TaskAssignment). Submission 1—0..1 Session. Speaker 1—* CommunicationLog.

---

## User flows

### Organizer

1. **Morning check (CORE loop)**: open event → Dashboard → greeting + days-to-event → KPI + status tiles → attention strip ("1 accepted session needs a time slot", "3 awaiting decision", "2 speakers missing bio/headshot") → click through to fix each → Speaker Tracking tab → see outstanding-task count, top-speakers-by-open-tasks list, overdue list → click a speaker → speaker detail with their open tasks and comms history → optionally trigger "send reminder now".
2. **Configure comms**: Settings/Communications → edit template (subject/body with variable picker) → save (validation rejects unknown variables) → preview with a sample speaker → toggle automation on/off → set reminder offsets.
3. **Decide a submission**: review queue → Accept → system flips status, creates portal access + default task assignments (tasks module), fires `accepted` email with magic link — organizer does nothing manual.
4. **Schedule a session**: agenda builder assigns slot/room → domain event → `schedule_assigned` email with ICS invite goes to each speaker on that session; moving the slot later fires `schedule_changed` with same UID, SEQUENCE+1.
5. **Bulk nudge**: Speaker Tracking → "speakers with outstanding tasks" segment → Send reminder → preview → confirm → log entries created.

### Speaker

1. Submits via public CFP form → immediately receives "submission received" email.
2. On acceptance → receives acceptance email with portal magic link → opens portal → sees task checklist → completes tasks (upload headshot, bio, slides, fill forms) → each completion updates TaskAssignment → dashboard numbers drop in near-real-time; reminders for that task stop.
3. Ignores tasks → receives scheduled reminder at T-7d, T-1d, and overdue nudge; each lists outstanding tasks + portal link; can unsubscribe from reminders.
4. Gets scheduled → receives calendar invite; clicks "Add to calendar" / accepts the native Gmail/Outlook invite; sees session time in their own timezone via the ICS; on reschedule receives update that replaces the old entry (same UID); on cancellation receives METHOD:CANCEL.

### Reviewer

- Only touches this area indirectly: their evaluation activity appears in the Review Progress widget (evaluated / in-progress counts). No reviewer-facing dashboard needed for the clone.

### Public visitor

- No public access to dashboards or comms. (Public gallery/schedule is another module.) Exception: the ICS download link in emails must work without login (tokenized URL), since calendar apps fetch it unauthenticated.

---

## Edge cases & bug traps

1. **Timezones (the #1 trap)**: event runs in venue tz (screenshots show PDT rendering); speakers are global. Store all instants as `timestamptz` (UTC); render admin UI in event tz with explicit tz label (screenshots print "PM PDT"); ICS must use `TZID` + embedded `VTIMEZONE` or UTC `Z` times — hand-rolling VTIMEZONE is error-prone, use a library (e.g. `ical-generator`) and verify import in Gmail *and* Outlook, which are pickier than Apple. "Days to event" = calendar-day diff in event tz, not `hours/24` (off-by-one across midnight).
2. **Double-sends**: trigger firing twice (retry, double status flip Accepted→Pending→Accepted, Workflow replay) must not email twice. Unique idempotency key on CommunicationLog, insert-before-send, and treat unique-violation as success.
3. **Reminder staleness**: reminders enqueued at assignment time go stale when a task is completed, its due date moves, or the speaker is un-accepted. Never trust the enqueue-time snapshot: re-check `status='open'`, current due date, and speaker's current status at send time. Cron-scan design ("every 15 min, find due reminder-rule × open-assignment pairs not yet logged") avoids the whole class.
4. **ICS update semantics**: reschedules with a *new* UID create duplicate calendar entries — the classic bug. Persist UID per speaker+session; bump SEQUENCE monotonically on every change; send METHOD:CANCEL (same UID) on unschedule/withdraw. `ORGANIZER` mailto must be a plausible address at your sending domain or Gmail may suppress RSVP buttons.
5. **Empty states**: brand-new event has 0 of everything — every widget needs a designed empty state ("No data", "Reviewer assignments will appear here once evaluations begin"), no NaN/divide-by-zero in percentage donuts (Sessionboard's own screenshots show 0-value tiles and "No data" panels).
6. **Count-definition drift**: Sessionboard itself shows Submissions=4 on Today but Total=2 on Pipeline. Define one counting rule (e.g. exclude drafts everywhere or include with label) in ONE SQL view consumed by all widgets and the public API, or judges will find the inconsistency.
7. **Dedup of participants**: "6 unique participants" dedups people across submissions/roles. Count `DISTINCT speaker.id` (email-keyed per event), not join rows.
8. **Missing-asset semantics**: "missing bio or headshot (2 bios, 2 headshots)" — banner counts asset instances, speaker count counts people. Define: speaker flagged if bio empty (whitespace-only = empty) OR no headshot; only for **accepted** speakers.
9. **Template rendering hazards**: null variables (speaker with no session yet receiving a schedule template) must fail loudly at preview/send-guard, not send "Hi {{speaker.first_name}}" or "undefined". HTML-escape all user content (submission titles like ";lkj" are literally in the test data — expect hostile/garbage input). Unknown-variable validation at save time.
10. **Magic links**: tokens must be single-audience (portal access ≠ ICS download), unguessable, long-lived until event end but revocable if a speaker is declined; ICS-download URLs are fetched by calendar clients with no cookies.
11. **Concurrent decisioning**: two admins accepting/declining the same submission concurrently → status transition should be a guarded UPDATE (`WHERE status='pending'`); comms trigger only on actual transition, so the loser's write sends nothing.
12. **Email deliverability during judging**: judges will test with real addresses. Need verified sending domain in Resend, plain-text alternative part, and a comms log UI ("sent, provider id X") so a spam-foldered email doesn't look like a bug. Dev/preview environments must run with sends stubbed to the log only (env-gated) so seeding doesn't spam real people.
13. **Task-completion race with reminder send**: speaker completes task while cron batch is mid-flight → acceptable at 15-min granularity, but check status inside the same transaction that inserts the log row.
14. **Dashboard performance (bonus points: speed)**: naive per-widget client fetch = 10 waterfall queries. Serve one aggregated read-model endpoint per dashboard page (single SQL with grouped CTEs), cache briefly, and let TanStack Query refetch-on-focus provide the "real-time" feel.
15. **OpenNext/Workers constraints**: no long-lived Node timers — scheduling must be Cloudflare Cron Triggers/Workflows, not `setInterval`; Node ICS/email libs must be Workers-compatible (check `nodejs_compat` needs before committing to a library).

---

## Simplifications

Where the clone can be simpler than Sessionboard without losing the brief's intent:

1. **Fixed dashboards, no builder**: skip Add Dashboard / Add Widget / AI-prompt / gallery / Settings-per-dashboard entirely. Ship one dashboard page with 2–3 tabs (Overview+Today merged, Speaker Tracking, optionally Pipeline) of hard-coded widgets. The CORE requirement is only the outstanding-tasks view.
2. **Drop widgets with no CORE value**: Exhibitors/Sponsors tiles (always 0 in the sandbox), Invoices, CRM, submission-pacing prior-edition comparison (needs multi-edition history the clone won't have), "Find or ask" search, announcements icon. Keep days-to-event and greeting (cheap delight).
3. **Refetch, not push**: "real-time" = TanStack Query with refetch-on-focus + short `staleTime`; no websockets/SSE.
4. **One comms channel**: email only. "Gmail, Outlook, iCal" in the brief describes calendar *formats*, all satisfied by RFC 5545 ICS attachments/links — no Google/Microsoft OAuth, no calendar-API writes.
5. **Fixed template set with editable subject/body**: the product analysis identifies seven domain template keys; the build adds `portal_login` as an eighth infrastructure/auth key so OTP and magic-link mail uses the same dispatcher. No arbitrary-template builder, per-speaker overrides, or drag-drop email designer — a textarea with variable insert buttons and live preview is enough.
6. **Fixed reminder ladder** (T-7d, T-1d, overdue+1d) editable as three offsets per event, not an arbitrary automation-workflow engine.
7. **Cron-scan scheduler** instead of per-reminder durable Workflows: the one every-minute jobs trigger invokes the idempotent reminder scan at minute multiples of 15. This preserves the analysis's 15-minute reminder cadence while sharing one restart-safe trigger with outbox and maintenance work.
8. **Evaluation/agenda widgets read from other modules' typed views**; if those modules slip, dashboard degrades gracefully (hide widget) — module boundary: dashboard is read-only over `dashboard_read` SQL views + the comms module's own tables; it never writes other modules' data.
9. **Participants-by-role**: hard-code the `Speakers` role (skip configurable role settings); keep dedup-by-email.
10. **Recent-submissions table**: plain table, no tags editing, no column config; link rows into the submissions module.
11. **Comms log = audit UI**: a simple filterable table per event (and per speaker) instead of Sessionboard's presumably richer comms center; satisfies debugging and judge-trust needs.
12. **Airtable export of this area**: one manual "Sync to Airtable" action + optional cron re-sync, one-way upsert of speakers/tasks/log — not live two-way sync.
