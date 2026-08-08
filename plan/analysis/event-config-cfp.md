# Feature Analysis: Event Config + Public CFP Page

Area: Event setup/configuration screens and the public call-for-speakers submission page.
Sources: hackathon brief (`/home/yi/Code/tmp/swyx-requirements/requirements.txt`) + 5 screenshots (cited below).
Stack (fixed): Next.js App Router + shadcn/ui + Tailwind, Neon Postgres (Airtable one-way export as bonus), OpenNext on Cloudflare Workers, Zustand (UI state), TanStack Query (server state), feature folders with typed module contracts.

---

## What the screenshots show — per screenshot

### 1. `10000201000008000000034E57E85CB7F1DC6FA2.png` — Sessionboard.com product-overview / marketing nav (IA reference)

Marketing site (sessionboard.com), "Products" mega-menu open. Relevant for overall IA, not literal UI to clone.

- Top nav: **SESSIONBOARD** logo, **Products** (open, chevron), **Platform** (chevron), **Resources** (chevron), **Pricing**, **Log in** button, **Request a demo** (primary blue CTA).
- Left column of mega-menu — the four product pillars (these map 1:1 to the in-app left nav seen in later screenshots):
  - **Program** — "Build and run your event program" (highlighted/active, chevron)
  - **CRM** — "The people behind this event" (chevron)
  - **Marketing** — "Turn your event into content and demand" (chevron)
  - **CMS** — "Deliver your content to your audience" (chevron)
- Center "Products" grid (8 items, icon + title + subtitle):
  - **Call for papers & grading** — "Manage speaker submissions"
  - **Abstract Management** — "For associations and enterprise teams"
  - **AI evaluators** — "AI tools to automate session selection"
  - **Agenda management** — "A way to build your agenda"
  - **Speaker management** — "Manage your speakers easily"
  - **Content management** — "Manage speaker content"
  - **Portals** — "Branded portals for speakers and sponsors"
  - **Awards** — "2026 Workshop Series"
- Bottom band: "Subscribe to product updates" with email input (`swyx@ai.engineer`) + submit arrow.
- Right rail: **AI Agents** with "Live now" green pill; agent list: **Reviewer**, **Scheduler**, **Coordinator**; card: **Team Lead** — "Orchestrates every agent across all products." (Maps to the brief's "very optional" AI-assisted review.)

IA takeaway: product = Program (CFP forms, abstracts/submissions, agenda), CRM (people), Marketing (comms), CMS (embeds/public pages), plus Portals and Dashboard. Our clone's admin nav should mirror: Dashboard / Program (Submission Forms, Abstracts, Agenda) / Speakers / Communications / CMS-Embeds / Settings.

### 2. `100002010000080000000589A77999B16F98E29C.png` — Event Settings > Overview (in-app, appv2)

Full admin app chrome plus the Event Settings hub page.

- Global top bar: Sessionboard logo (megaphone icon), **"Find or ask"** search input with `⌘K` hint, **View Portal** button, announcements (megaphone icon with red dot), help (?), user avatar **SY**.
- Left app sidebar, top: **event switcher** — avatar "AS", "AI.Engineer Sand…" (truncated event name), date range "Oct 12–14, 2026", up/down chevron (implies multiple events per org).
- Left app sidebar nav: **Dashboard**, **Program** (expandable chevron), **CRM** (chevron), **Marketing**, **CMS** (chevron); divider; **Reports**, **Studio**, **History**; divider; **Event Team**, **Preview**, **Settings** (active/highlighted). Bottom-left: grid/apps icon.
- Page header: back arrow, gear icon, **"Event Settings"** title, subtitle "Configure event details and preferences".
- Settings sub-nav (left column of content area): **Overview** (active), **Event Details**, **Library** (collapsible, expanded: **Fields**, **Tags**, **Personas**), **Record Settings**, **Portals**, **Submission Forms**, **Email Templates**, **Email Themes**, **Integrations**.
- Overview body — card grid grouped in 4 sections, each card = icon + link title + description:
  - **Event setup**: **Event Details** ("Name, dates, timezone, and the basics."), **Record Settings** ("Record layouts and field configuration."), **Portals** ("Speaker and exhibitor portal appearance."), **Submission Forms** ("Submission form appearance and content.")
  - **Library**: **Fields** ("Custom fields for contacts, sessions, and submissions."), **Tags** ("Reusable labels across records."), **Personas** ("Audience segments and attendee types.")
  - **Communications**: **Email Templates** ("Transactional email content."), **Email Themes** ("Branding applied to your emails.")
  - **Configuration**: **Integrations** ("Connect Cvent, Swoogo, Zoom, and more.")

### 3. `10000201000008000000058BAAB3C268A31688D8.png` — Event Settings > Event Details (top half)

Same chrome/sub-nav; **Event Details** active. Heading "Event Details", subtitle "Configure basic event information". Two-column form:

- **Event Name** * (required, red asterisk) — text input, value "AI.Engineer Sandbox Event - NYC".
- **Event Slug** * (required, info tooltip icon) — text input, value "ai-engineer-sandbox-event". (Used in public CFP URL: `/submit/ai-engineer-sandbox-event/…`.)
- **Event Type** (info icon) — select dropdown, value **"Conference"** (implies other types: summit, workshop, etc.).
- **Event Website URL** (info icon) — text input, value "ai.engineer".
- **Event Location** (info icon) — text input, value "New York".
- **Timezone** (info icon) — select, value "(GMT-8:00) America/Los_Angeles (Pacifi…" with stepper chevrons.
- **Starts At** * (required, info icon) — datetime picker: calendar icon, "October 12th, 2026 at 9:00 AM", inline **PDT** tz label, **×** clear button.
- **Ends At** * (required, info icon) — datetime picker: "October 14th, 2026 at 5:00 PM", **PDT**, **×** clear.
- **Theme** — large textarea, helper "This helps improve search, recommendations, and how content is organized.", value "Test Event for NYC", char counter **"18 / 1000"**.
- **Save** primary button at bottom.

### 4. `10000201000008000000058AD1C105904079506F.png` — Event Settings > Event Details (bottom half)

Continuation of the same page (top shows the tail of the Theme textarea with "18 / 1000").

- Section **"Exhibitors & Sponsors"** — "Enable exhibitor and sponsor groups for this event. Advanced portal and contact features are managed by your Sessionboard team."
  - Prompt: "Which group types do you want to manage for this event?"
  - Two large toggle cards, both selected (blue border + green check badge): **Exhibitors** (storefront icon), **Sponsors** (people icon).
- Section **"Image Settings"** — "Upload event logo and background images".
  - **Logo Image** — "Recommended: 300 w x 300 h" — dashed-border upload dropzone (upload icon) + **"+ Upload new"** blue split-button with chevron (dropdown implies pick-from-library option).
  - **Background Image** — "Recommended: 1500 w x 500 h" — same dropzone + "+ Upload new" split-button.
- **Save** primary button.

### 5. `1000020100000800000005C1384167674CE465AF.png` — Public CFP submission page (step 1 of 5)

Public unauthenticated page at `appv2.sessionboard.com/submit/ai-engineer-sandbox-event/034fa450-8851-4c25-bf01-5252dbb…` — URL pattern `/submit/{event-slug}/{form-uuid}`. (Brief also cites a second live form UUID `b7d4d7cd-…` for the same event, confirming multiple submission forms per event.)

- **Step wizard** across top: ① **Welcome!** (active, highlighted) → ② **Account** → ③ **Submission** → ④ **Participant** → ⑤ **Review**, with arrows between steps.
- **Info banner** (bordered box, centered):
  - "Form submissions will be accepted until **September 15 at 11:59 PM PDT**." (deadline enforcement, tz-aware)
  - "**Submission Limit: 3 submissions per user**" (per-user cap)
- Rich-text welcome content (organizer-authored HTML/rich text):
  - H1 "**Welcome to our event!**"
  - Subheading "**Call for Speakers**" + paragraphs of event pitch; "Our conference will take place on X date at Y time."
  - "Here are the different tracks we offering:" + bullet list: **Topic A, Topic B, Topic C, Topic D** (tracks/categories surfaced to submitters).
  - Paragraph explaining: use this form to submit; use the portal to track submission status; if approved you'll receive a list of tasks to complete within the portal. (Explicitly ties CFP → speaker portal → tasks pipeline.)
  - "**Helpful Tips and Important Information**" — 3 hyperlinks: "Speaker Agreement Terms and Conditions", "FAQs for Speaker Application Process", "Speaker Tips and Resources Guide".
  - "**Dates and Deadlines**" — bullets: "Call for Speakers will open **X Date**.", "Presentation submissions are due by **Y Date,** by **11:59 PM EST**", "*(Late submissions will not be accepted, no exceptions.)*", "Our event will take place the week of X Date."
- Bottom-right: partially visible primary blue button (Next/Get Started) to advance the wizard.
- Card layout: white centered card on gray background, no admin chrome (public-facing, brandable via event logo/background image from Event Details).

Steps 2–5 are not shown in this screenshot set but are named: **Account** (identify/sign-in the submitter — enables the 3-per-user limit and later portal access), **Submission** (talk fields: title, abstract, format, track — the "custom form with conditional logic and category-based routing" from the brief), **Participant** (speaker/co-speaker profile: name, email, bio, headshot), **Review** (read-back + confirm/submit).

---

## Required capabilities

Numbered functional requirements for a good-enough clone. [CORE] = in the brief's 9 primary features (or a hard prerequisite for one). [NICE] = visible in screenshots / optional in brief.

### Event configuration

1. [CORE-prereq] **Event CRUD**: create/edit an event with Name*, Slug* (unique, URL-safe, drives public URLs), Event Type (enum select: Conference/Summit/Workshop/Meetup/Other), Website URL, Location (free text), Timezone (IANA select), Starts At*, Ends At* (datetimes rendered in event tz), Theme/description (textarea, 1000-char cap with live counter). Save with validation errors inline.
2. [CORE-prereq] **Event branding**: upload Logo Image (~300×300) and Background/banner Image (~1500×500); applied to the public CFP page, speaker portal, and public gallery/schedule pages.
3. [CORE-prereq] **Tracks management**: organizer defines the event's tracks/categories (name, order; optionally color + description). Tracks feed the CFP form's track selector, category-based routing, agenda conflict detection, and the public schedule's track view.
4. [CORE-prereq] **Rooms management**: organizer defines rooms (name, order; optionally capacity). Needed by drag-and-drop agenda + conflict detection ("across rooms and tracks") and the room view of the schedule.
5. [CORE-prereq] **Session formats**: organizer defines session formats/types (e.g. Keynote, Talk, Workshop, Panel; name + default duration). Selectable on CFP form and on agenda sessions.
6. [NICE] **Settings hub page**: an Event Settings overview with grouped cards linking to sub-pages (Event Details, Submission Forms, Tracks/Rooms/Formats, Email Templates, Portal/Embeds settings) mirroring Sessionboard's Overview screen. Cheap to build, strong demo-parity signal.
7. [NICE] **Multi-event support with event switcher** in the sidebar (event-scoped data everywhere via `event_id`). Even if the demo uses one event, scoping all tables by `event_id` from day one is near-free and matches the switcher shown.
8. [NICE] **Custom field library** (Fields/Tags/Personas): reusable custom fields for submissions/contacts. Only build as far as "custom questions on a submission form" (see #10); skip standalone library UI.
9. [NICE] **Exhibitors/Sponsors group toggles, Record Settings, Email Themes, Integrations settings pages**: shown in screenshots but out of the brief's scope — omit or stub.

### Submission forms (builder) — brief feature #1

10. [CORE] **Submission form builder** (Program > Submission Forms > Create): create ≥1 submission form per event; each form has: title, slug/UUID for the public URL, rich-text Welcome content, open/close datetimes (with timezone), per-user submission limit, active/closed status, and an ordered set of questions. Question types minimum: short text, long text/rich text, single-select, multi-select, checkbox, file upload; each with label, help text, required flag, options list.
11. [CORE] **Conditional logic**: show/hide a question based on a previous answer (e.g. "If Format = Workshop, show 'Workshop duration'"). Model as `condition: {questionId, operator(eq/in), value}` per question. Single-level conditions are enough.
12. [CORE] **Category-based routing**: the track/category chosen on the form routes the submission (to a track-specific reviewer queue / assigns the track on the submission record). Minimum viable: track select is a first-class form field; submissions land pre-tagged by track and reviewers can filter/be assigned by track.
13. [CORE] **Public form URL**: `/submit/[eventSlug]/[formId]` — publicly accessible, no auth to view, branded with event logo/background, mobile-friendly.
14. [NICE] **Multiple concurrent forms per event** (e.g. "CFP" + "Sponsor talk form") — data model supports it (form UUID in URL proves it); UI can just be a list + create.

### Public CFP submission experience — brief feature #1 (submitter side)

15. [CORE] **Step wizard**: Welcome → Account → Submission → Participant → Review, with a visible stepper, Next/Back, and per-step validation.
16. [CORE] **Welcome step**: renders organizer-authored rich text (headings, paragraphs, bullet lists, hyperlinks) + an info banner showing the deadline ("accepted until {date} at {time} {tz}") and the submission limit ("N submissions per user").
17. [CORE] **Account step**: identify the submitter by email (magic-link or lightweight signup: email + name + password-or-code). This identity (a) enforces the per-user submission limit, (b) becomes the speaker-portal login after acceptance, (c) lets a returning user see their prior submissions' statuses.
18. [CORE] **Submission step**: dynamic renderer for the form's configured questions (incl. conditional visibility and track select); client + server validation of required fields; file-upload questions store to object storage (Cloudflare R2).
19. [CORE] **Participant step**: speaker profile fields — first/last name, email (prefilled from account), job title, company, bio, headshot upload; support adding **co-speakers** (name + email at minimum). (This seeds the self-service speaker portal profile.)
20. [CORE] **Review step**: read-only summary of all answers grouped by step, edit-links back to steps, then Submit.
21. [CORE] **Confirmation**: post-submit confirmation screen + automated confirmation email (feeds brief feature #3, templated communications); submission appears in organizer's Program > Abstracts list with status "Submitted"/"Pending review".
22. [CORE] **Deadline + limit enforcement (server side)**: reject submissions after close datetime and beyond the per-user cap, with friendly UI states ("This form closed on …", "You've reached the submission limit").
23. [NICE] **Draft persistence**: autosave in-progress wizard state (at minimum: client-side persistence via Zustand + localStorage keyed by formId; ideally a server-side draft row after the Account step).
24. [NICE] **Returning-submitter view**: "Your submissions (2/3)" list with statuses on the CFP page after sign-in.

### Cross-area contracts this area must expose

25. [CORE] Submissions created here are the input to **evaluation/scoring** (brief #4), **agenda building** (brief #5 — accepted submissions become schedulable sessions carrying track + format + duration), the **speaker portal** (brief #2/#6 — participant identity + tasks after acceptance), and **speaker gallery/schedule embeds** (brief #9 — event branding, tracks, rooms).
26. [NICE-bonus] **Public API + Airtable export**: read API for event config (event, tracks, rooms, formats, forms) and submissions; one-way Airtable sync job for events/submissions/speakers tables (Cloudflare Workers cron/workflow).

---

## Data entities

- **Event** — id, org/owner, name*, slug* (unique), type (enum), websiteUrl, location, timezone (IANA), startsAt (timestamptz), endsAt (timestamptz), themeDescription (≤1000), logoUrl, backgroundUrl, createdAt/updatedAt. Root aggregate: everything else carries `eventId`.
- **Track** — id, eventId, name, order, color?, description?. (Feeds CFP select, routing, agenda, schedule views.)
- **Room** — id, eventId, name, order, capacity?. (Feeds agenda + conflict detection.)
- **SessionFormat** — id, eventId, name, defaultDurationMins, order.
- **SubmissionForm** — id (UUID, in public URL), eventId, title, welcomeRichText (HTML/JSON), opensAt?, closesAt (timestamptz), submissionLimitPerUser (int), status (draft/open/closed), createdAt.
- **FormQuestion** — id, formId, order, type (short_text|long_text|rich_text|single_select|multi_select|checkbox|file|track_select|format_select), label, helpText?, required (bool), options (jsonb)?, condition (jsonb: {questionId, op, value})?, mapsTo? (built-in target: submission.title / submission.abstract / submission.trackId / submission.formatId — so key answers land in typed columns, not only jsonb).
- **SubmitterAccount / User** — id, email (unique), name, authMethod (magic link/code), createdAt. Same identity later logs into the speaker portal. Roles (organizer/reviewer/speaker) via membership table per event.
- **Submission** — id, formId, eventId, submitterUserId, status (draft|submitted|in_review|accepted|rejected|waitlisted|withdrawn), title, abstract, trackId?, formatId?, submittedAt, answers relation.
- **SubmissionAnswer** — id, submissionId, questionId, value (jsonb: string | string[] | fileRef). Alternative: single `answers jsonb` on Submission keyed by questionId; separate rows are friendlier for review filtering/export.
- **SpeakerProfile (Participant)** — id, userId, eventId, firstName, lastName, email, jobTitle?, company?, bio?, headshotUrl?; join table **SubmissionSpeaker** (submissionId, speakerProfileId, role: primary|co_speaker) for co-speakers.
- **FileAsset** — id, eventId, kind (logo|background|headshot|attachment|slide), url/objectKey (R2), filename, size, mime, uploadedBy.
- Relationships: Event 1—N Track/Room/SessionFormat/SubmissionForm; SubmissionForm 1—N FormQuestion, 1—N Submission; Submission N—1 Track/Format, 1—N SubmissionAnswer, N—M SpeakerProfile; User 1—N Submission (limit check), 1—N SpeakerProfile (per event).

---

## User flows

### Organizer — set up an event
1. Create event: enter name → slug auto-generated (editable, uniqueness-checked) → type, location, website, timezone → start/end datetimes → theme description → Save.
2. Upload branding: logo + background image (validated size/type, stored in R2, preview shown).
3. Define program vocab: add tracks (Topic A–D…), rooms, session formats with default durations; reorder via drag.
4. Create submission form: Program > Submission Forms > Create → title → write Welcome rich text (pitch, tips links, dates/deadlines) → set close datetime + per-user limit → add/reorder questions, mark required, add options, attach conditions, include track selector → preview → publish → copy public URL `/submit/{slug}/{formId}`.
5. Later: edit form copy/deadline; close form early; watch submissions arrive in Program > Abstracts.

### Public visitor / prospective speaker — submit a talk
1. Opens public URL (from event website/social). Sees branded Welcome step: pitch, tracks list, tips links, deadline banner + limit. Clicks Next.
2. Account step: enters email (+ name) → verifies via magic link/code (or signs in if returning). If returning and at limit → blocked with message; if form closed → closed page, no wizard.
3. Submission step: fills dynamic questions (title, abstract, format, track, extras); conditional questions appear as answers change; uploads any files; inline validation on Next.
4. Participant step: completes/edits profile (name, title, company, bio, headshot); optionally adds co-speaker(s) by name+email.
5. Review step: verifies grouped summary; jumps back to fix; Submits.
6. Confirmation screen ("You'll hear from us; track status in the portal") + confirmation email. Can submit again up to the limit; can view statuses of prior submissions.

### Speaker (post-submission touchpoints owned by this area)
1. Receives confirmation email with portal link.
2. Signs into portal with the same account; sees submission status (Submitted → In review → Accepted/Rejected). (Portal tasks/profile upkeep are the portal area's scope; identity + status originate here.)

### Reviewer (touchpoint owned by this area)
1. Reviewer sees submissions pre-tagged by track (category-based routing) and filtered to their assigned track(s); form answers (SubmissionAnswer rows + typed columns) render in the review UI. (Scoring UI itself is the evaluation area's scope.)

---

## Edge cases & bug traps

1. **Timezones (the classic)**: store all instants as `timestamptz` (UTC); store the event's IANA timezone separately; render deadlines/dates in the *event's* tz with explicit label ("Sep 15 at 11:59 PM PDT"), not the viewer's. Never compare deadline using client clock — server is authoritative. Watch DST: "11:59 PM PDT" vs PST across a DST boundary; using a fixed UTC offset instead of IANA zone will drift.
2. **Deadline race**: user opens the form at 11:50, submits at 12:05 — server must re-check `closesAt` at submit time and return a friendly "form closed while you were writing" state that preserves their answers (offer copy-to-clipboard or draft save), not a silent 500 or data loss.
3. **Submission-limit race**: two tabs submitting simultaneously can both pass a read-then-write check. Enforce in one transaction (`SELECT count FOR UPDATE` / unique partial index / check inside insert CTE).
4. **Slug pitfalls**: enforce uniqueness (global or per-org) with a DB unique constraint, not app-level check; sanitize to `[a-z0-9-]`; decide behavior on rename after the URL is shared (safest: warn + keep old slug redirecting, or make slug immutable after first publish). Reserved words (`submit`, `api`, `admin`) must be excluded.
5. **Form edited/deleted mid-flight**: organizer reorders/deletes a question while a visitor is mid-wizard → submitted answers reference missing questionIds. Version pragmatically: forbid structural edits once form is open + has submissions (allow copy/dates edits), or snapshot question set per submission. Also handle deleted form/event → public URL renders 404-with-branding, not a crash.
6. **Conditional-logic traps**: hidden-question answers must be discarded server-side (user answers Q, flips the controlling answer, Q hides — stale answer must not persist or fail required-validation). Required + hidden = not required. Guard against condition cycles/forward references (only allow conditions on earlier questions).
7. **Wizard state loss**: refresh/back-button mid-wizard wipes answers if state is only in memory — persist to localStorage (Zustand persist) keyed by formId, and clear on successful submit. Browser Back should go to previous step, not exit the page (sync step to URL query or history state).
8. **Account step edge cases**: same email, different casing → normalize/lowercase before unique check; magic-link opened on a different device than the wizard tab (code-entry fallback avoids this); existing organizer email submitting a talk (roles are per-event memberships, not exclusive).
9. **Uploads**: enforce max size/MIME server-side; headshot/logo dimension guidance is a hint, not a blocker; upload succeeded but form abandoned → orphaned R2 objects (periodic cleanup or attach-on-submit); Workers request-size limits mean uploads should go direct-to-R2 via presigned URL, not through the Next.js server action.
10. **Empty states everywhere**: event with no tracks/rooms/formats (form builder must degrade: hide track select or block publish with "add tracks first"); form with zero questions; welcome text empty; no submissions yet in admin list; missing logo (fall back to event name text).
11. **Rich-text XSS**: Welcome content and organizer HTML render on a public page — sanitize server-side (allowlist) or store a structured doc (TipTap JSON) and render through a component, never `dangerouslySetInnerHTML` on raw input. Same for the portal wiki/HTML embeds area — share one sanitizer module.
12. **Char limits & validation parity**: enforce the 1000-char theme cap (and question maxlengths) in both client counter and server (grapheme vs UTF-16 length mismatch — pick one, use it in both places via a shared zod schema).
13. **Start/end datetime validation**: endsAt > startsAt; form closesAt should not require being before event start (late-breaking CFPs exist) but warn; clearing (×) a required datetime must fail save with message.
14. **Concurrent organizer edits**: two admins editing Event Details → last-write-wins silently loses data; cheap fix: `updatedAt` optimistic-concurrency check returning "settings changed since you loaded".
15. **Multi-event scoping bugs**: every query must filter by `eventId`; with parallel AI agents building modules, an unscoped query is the #1 predictable leak — bake `eventId` into repository-layer function signatures (no default), and into every unique index.
16. **Caching**: public CFP page should be fast (bonus points) but the deadline banner/open-closed state must not be stale-cached past `closesAt` — use short revalidate or compute open/closed at request time on the edge.
17. **Airtable export**: one-way and idempotent (upsert by our primary key stored in an Airtable field); Airtable rate limits (5 rps) mean batch + queue via Workers, never inline in the request path; export failure must never block the primary Postgres write.

---

## Simplifications (keep the brief's intent, cut Sessionboard's surface)

1. **Single-tenant, few events**: skip orgs/workspaces/multi-team; one organizer team, `eventId` scoping + a simple event switcher. Skip Event Team management, roles beyond organizer/reviewer/speaker.
2. **Collapse the Settings maze**: one Event Settings area with tabs: Details (incl. branding), Tracks/Rooms/Formats, Submission Forms. Drop Record Settings, Fields/Tags/Personas library, Personas, Email Themes, Integrations pages entirely (email templates live with the Communications feature area).
3. **Fixed core submission fields + custom extras**: instead of a fully generic field engine, hardcode Title, Abstract, Track, Format, plus an ordered list of custom questions of ~6 types. Covers "custom forms with conditional logic" at a fraction of the builder complexity.
4. **One level of conditional logic** (question shows if prior answer matches), no branching pages, no logic groups/AND-OR trees.
5. **Category routing = track assignment + reviewer track filter**, not a rules engine.
6. **Structural form edits locked after first submission** (dates/copy always editable) instead of form versioning.
7. **Auth**: email magic-link/OTP for submitters/speakers; simple credential or allowlist login for organizers. No SSO/OAuth matrix.
8. **Exhibitors/Sponsors toggles, Awards, Studio, History, Reports, CRM module**: omit — not in the brief's 9 features.
9. **Event Type / Theme fields**: keep as simple inputs (they're cheap demo-parity), but nothing consumes them beyond display — no "search/recommendations" behavior.
10. **Branding**: logo + background image + accent color is enough; no per-portal theming engine or email theme designer.
11. **Rich text**: one editor (e.g. TipTap) reused for Welcome content, email templates, and wiki pages; store JSON, sanitize on render — one shared module, three features.
12. **Wizard steps fixed** (Welcome/Account/Submission/Participant/Review) rather than configurable step builder — organizers only customize Welcome content and the Submission questions; matches the screenshot UX exactly.
13. **AI review**: skip or stub (brief says "very optional"); Accelevents waived. Dashboard = simple counts + outstanding-task list (optional-but-nice), fed by statuses this area already produces.
