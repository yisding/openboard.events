# Feature analysis: Agenda builder + public schedule/gallery embeds

Assigned area: **Program > Agenda** (drag-and-drop schedule building, rooms/tracks, conflict
detection, multiple views) and **CMS > Embeds** (embeddable, mobile-friendly public speaker
gallery and schedule itinerary). Reference for the target public output:
https://wf2025.ai.engineer/schedule (cited in the brief as the kind of public schedule AIE
publishes — noted as reference only, not fetched).

Brief language this area must satisfy (verbatim from requirements.txt):

- "Drag-and-drop schedule and agenda building, with automatic conflict detection across rooms
  and tracks, viewable by list, day, week, track, or room" — **primary feature**.
- "Embeddable, mobile-friendly speaker gallery and schedule itinerary we can post to our
  website" — **primary feature** (the *CMS > Embeds admin configurator* screenshot is labeled
  OPTIONAL, but the public gallery/schedule output itself is in the primary list).

---

## What the screenshots show

### 1. `10000201000008000000057D61BDF7F9D3266B0D.png` — Program > Agenda (empty list view)

**Global chrome (top bar):**
- Global search input "Find or ask" with `⌘K` shortcut hint.
- "View Portal" button (switches to the speaker-portal view of the event).
- Announcements/megaphone icon with red notification dot; help "?" icon; user avatar "SY".

**Left sidebar (event-scoped nav, Program module expanded):**
- Event switcher card: avatar "AS", "AI.Engineer Sand…" (AI.Engineer Sandbox Event),
  date range "Oct 12–14, 2026", up/down chevron to switch events. The 3-day event range
  is what drives Day tabs / Week view width.
- "Overview" (partially obscured by cursor).
- Section **SUBMISSIONS**: View All, Abstracts, Sessions, Files.
- Section **COLLECT & REVIEW**: Forms, Evaluation, **Agenda** (active, highlighted with blue
  pill + outline), Invoices, Site.
- Section **PORTALS**: Portals, Tasks, Forms, File Requests, Resources, Files.
- Section **CONFIGURE**: Settings.
- Below Program: CRM (chevron >), Marketing, CMS (expand chevron) — top-level modules.
- Bottom-left: app/grid icon button.

**Page header:** calendar icon + title "Agenda", subtitle "Manage your event agenda and
schedule".

**View tabs (the key requirement):** `List` (active, underlined) · `Day` · `Week` · `Month` ·
`Rooms` · `Conflicts` (warning-triangle icon). Note: brief asks for "list, day, week, track,
or room"; Sessionboard shows Month too and gives Conflicts its own dedicated tab. Track view
is not a tab here — tracks surface via filters/columns/grouping.

**Toolbar row (list view):**
- Search input "Search sessions…".
- Icon button (row-density / display options toggle).
- "Saved Views" dropdown (eye icon + chevron) — named, persisted filter/column combos.
- "Columns" button (active/outlined) — column chooser for the list table.
- "Sort" button (arrows icon).
- "Filter" button (funnel icon).
- "Drafts" button (document icon) — holding area for unscheduled/unpublished sessions.
- "Options" overflow (… menu).
- Primary CTA: "+ Add Session" (blue).

**Body:** empty state — calendar glyph in a grey circle, "Nothing here yet", "Sessions will
appear here in list view". (Confirms every view needs a designed empty state.)

### 2. `1000020100000800000005ABC2D820FFA7132CCA.png` — CMS > Embeds (list)

**URL:** `appv2.sessionboard.com/event/6703/cms/embeds` — embeds are event-scoped.

**Left sidebar (top-level nav, CMS expanded):**
- Dashboard; Program (>); CRM (>); Marketing; **CMS** (expanded: Overview, **Embeds** active);
  Reports; Studio; History; Event Team; Preview; Settings.

**Page header:** code `< >` icon + title "Embeds", subtitle "Export a feed of your agenda,
sessions, or speakers to place in your app or website."

**Toolbar:**
- Search input "Search by name, format, or ID…".
- Segmented filter pills with counts: `All 1` (active) · `Enabled 1` · `Disabled 0` —
  embeds have an enabled/disabled status.
- Primary CTA "+ Add Embed" with dropdown chevron (dropdown implies choosing a format at
  creation time).

**Body:** collapsible group header "Styled HTML  1" (embeds grouped by format, count badge,
collapse chevron). One embed card: name "New Embed", green `Enabled` status badge, copy-code
icon button, "…" overflow menu (rename/disable/delete/duplicate implied).

### 3. `10000201000008000000058BCA4D5E3BED6CD62E.png` — CMS > Embeds > embed editor

**Left config panel:**
- Back arrow + title "New Embed".
- Section **Type** (collapsible, expanded):
  - `Name *` (required, info tooltip icon) text input, value "New Embed".
  - `Enabled` labeled toggle switch (on).
  - `Format *`: card "Embed Styled HTML" with lock icon + "Locked" label. Description text:
    "Configure settings for styled HTML feeds including **Agenda, Session List, Schedule
    Itinerary, Speaker List, and Speaker Gallery**. Each embed can be placed directly in your
    website and will **auto-update** with speaker and session details." Plus: "Create a new
    embed to use a different format." → format is immutable after creation; one embed serves
    five content types.
- Collapsed sections (accordion): **Style Options** · **Filters** (count badge `1` — at least
  one filter is applied, e.g. only-published sessions) · **Field Options** (choose which
  fields render, e.g. show/hide company, bio, times).

**Right preview panel:**
- Tabs: `Preview` (active) / `Get Code` (`</>` icon). Top-right label: "Styled HTML".
- Simulated browser chrome: traffic-light dots; **content-type dropdown set to "Agenda"**
  (the five types from the format description); desktop/mobile device-preview toggle icons
  (mobile-friendliness is checked in-editor); "Copy code" button; refresh icon; open-in-new-tab
  icon.
- Mock URL bar: `https://www.yoursite.com/agenda` + query string **`?sb-speaker-id=abc123`**
  with a "Go" button — demonstrates deep-linking the embed via query params on the *host*
  page (e.g. `sb-speaker-id` opens one speaker's detail inside the embed). Implies the embed
  script reads the parent URL's query params.
- Rendered preview: blue banner "AI.Engineer Sandbox Event - NYC", dark collapsible panel with
  ">" chevron (itinerary/agenda body, empty since no sessions exist), footer
  "Powered by SESSIONBOARD" (white-label branding footer).

---

## Required capabilities

Tagging: **[CORE]** = demanded by the brief's primary-features list; **[NICE]** = visible in
Sessionboard or optional in the brief.

### Agenda building

1. **[CORE]** Session CRUD: create/edit/delete sessions with title, description, start/end
   datetime, duration, room, track, session type/format (talk, keynote, workshop, panel,
   break), and assigned speakers (multi-select from event speakers/accepted abstracts).
2. **[CORE]** Rooms management: event-scoped list of rooms (name, optional capacity, sort
   order); CRUD from within the agenda UI (e.g. "+ Add room" column).
3. **[CORE]** Tracks management: event-scoped tracks (name, color); color badges shown on
   session cards everywhere (admin views and public schedule).
4. **[CORE]** Drag-and-drop scheduling on a time-grid: drag a session to a new time and/or
   room column; drag edges to resize (change duration); drag unscheduled sessions from a
   holding panel ("Drafts"/unscheduled tray) onto the grid; snap to a time increment
   (5- or 15-minute); optimistic UI update with server persist.
5. **[CORE]** Automatic conflict detection, recomputed on every schedule change:
   a. Room conflict — two sessions overlapping in time in the same room.
   b. Speaker conflict — one speaker assigned to two time-overlapping sessions (any rooms).
   c. (Track conflict — two same-track sessions overlapping — brief says "across rooms and
      tracks"; include as a warning-level rule.)
   Surface conflicts as: red/warning highlight on the session cards, a badge count on the
   Conflicts tab, and a dedicated Conflicts view listing each conflict pair with type,
   sessions, time range, and jump-to links. Back-to-back sessions (end == start) are NOT
   conflicts — interval semantics must be half-open `[start, end)`.
6. **[CORE]** Views, switchable via tabs:
   - **List** — table of all sessions: columns for Title, Date, Start–End, Room, Track,
     Speakers, Status; sortable; searchable.
   - **Day** — vertical time axis × room columns for one selected day (day-switcher tabs
     across the event date range); this is the primary drag-and-drop surface.
   - **Week** — event days side-by-side (a 3-day event shows 3 columns), read-only or
     drag-enabled.
   - **Track** — sessions grouped/laned by track (grouped list or track-column grid).
   - **Room** — sessions grouped by room (per-room agenda), i.e. Sessionboard's "Rooms" tab.
   - **Conflicts** — the conflict report view (5c above).
7. **[CORE]** Session status: `draft` vs `published` (confirmed). Only published sessions
   appear in public embeds. A "Drafts"/unscheduled tray holds sessions with no time slot.
8. **[CORE]** Search sessions by title/speaker within the agenda; filter by room, track, day,
   status; sort in list view.
9. **[CORE]** Event timezone: schedule authored and displayed in the event's IANA timezone
   (event setting), stored as `timestamptz` in Postgres.
10. **[NICE]** Promote an accepted abstract/submission to a session in one click (link to
    the Abstracts/Evaluation area — cross-module contract: session references submission).
11. **[NICE]** Month view (Sessionboard has it; brief does not ask).
12. **[NICE]** Saved Views (named persisted filter/sort/column sets), Columns chooser,
    row-density toggle.
13. **[NICE]** Bulk operations from list view (bulk publish, bulk delete, bulk shift times).
14. **[NICE]** Keyboard/cursor niceties: duplicate session, nudge time, undo last move.

### Public schedule + speaker gallery (embeds)

15. **[CORE]** Public, mobile-friendly **schedule itinerary** page per event: sessions grouped
    by day (day tabs/anchors), ordered by time, showing time range, title, room, track badge
    (color), speaker names + headshots; session detail (expand or subpage) with description
    and speaker links; filter by day/track/room; text search. Style target:
    wf2025.ai.engineer/schedule. Renders only `published` sessions.
16. **[CORE]** Public, mobile-friendly **speaker gallery** page per event: responsive card
    grid of confirmed speakers — headshot, name, title, company; click → speaker detail
    (bio + their sessions with links back to the schedule).
17. **[CORE]** Both are **embeddable on an external website**: provide a copy-paste snippet
    (iframe, or a small script tag that injects a responsive iframe). Served with
    `frame-ancestors *` / no `X-Frame-Options` so third-party sites can frame it; auto-resize
    height (postMessage) if using the script variant.
18. **[CORE]** Embeds **auto-update** with speaker/session changes (fresh on each load or
    short cache TTL / tag-based revalidation — no manual re-export step).
19. **[NICE]** Embed configurator (CMS > Embeds admin screens): named embed records with
    enabled/disabled toggle; list with search + All/Enabled/Disabled pills; format grouping;
    editor with live Preview + Get Code tabs and desktop/mobile preview toggle;
    Style Options (accent color, theme), Filters (limit to track/day/status), Field Options
    (show/hide fields); five content types (Agenda, Session List, Schedule Itinerary,
    Speaker List, Speaker Gallery).
20. **[NICE]** Deep-linking into an embed via host-page query params (`sb-speaker-id=…`,
    and by analogy `sb-session-id=…`) so a website can link to one speaker/session.
21. **[NICE]** Disabled embed returns an inert/empty response (kill switch) — enabled toggle
    actually gates public serving.
22. **[NICE]** Public JSON feed of sessions/speakers (same data as the embed) — cheap to add
    and doubles as the "bonus points for API" item.
23. **[NICE]** "Powered by" footer (skip or brand as our own OSS project).

### Cross-cutting (stack-mandated)

24. **[CORE]** Airtable one-way export: push Sessions, Rooms, Tracks, Speakers tables to
    Airtable on demand/schedule (Neon Postgres remains the source of truth).
25. **[CORE]** Performance: public schedule/gallery served static-fast (edge-cached or ISR on
    Cloudflare Workers via OpenNext) — "bonus points for speed/performance; we do not want
    slow SaaS".

---

## Data entities

- **Event** — id, slug, name, starts_on, ends_on, timezone (IANA), venue/city. Parent of
  everything below. (Owned by another module; this area consumes it.)
- **Room** — id, event_id FK, name, capacity?, sort_order. Unique (event_id, name).
- **Track** — id, event_id FK, name, color (hex), sort_order. Unique (event_id, name).
- **Session** — id, event_id FK, title, slug, description (rich text/markdown),
  session_type enum (talk | keynote | panel | workshop | break | other),
  starts_at timestamptz NULL, ends_at timestamptz NULL (NULL pair = unscheduled/draft tray),
  room_id FK NULL, track_id FK NULL, status enum (draft | published), submission_id FK NULL
  (link back to accepted abstract), updated_at + version (optimistic concurrency), created_at.
  CHECK (ends_at > starts_at). Indexes: (event_id, starts_at), (room_id, starts_at).
- **SessionSpeaker** — join: session_id FK, speaker_id FK, role enum (speaker | moderator |
  panelist)?, sort_order. Unique (session_id, speaker_id). Speaker entity itself (name, title,
  company, headshot_url, bio, confirmed status) is owned by the speaker-portal/CRM module —
  this area reads it; the public gallery filters on confirmed/published speakers.
- **Conflict** — *derived, not stored*: computed as overlapping half-open intervals sharing a
  room, a speaker, or a track. Type: { kind: room|speaker|track, session_a, session_b,
  overlap_start, overlap_end, subject_id }.
- **Embed** — id, event_id FK, public_token (unguessable slug for the serving URL), name,
  format ('styled_html'), content_type enum (agenda | session_list | schedule_itinerary |
  speaker_list | speaker_gallery), enabled bool, style_options jsonb, filters jsonb,
  field_options jsonb, created_at, updated_at.
- **SavedView** [NICE] — id, event_id, name, view_kind, filters/sort/columns jsonb, user_id.
- **AirtableSyncState** — per-table cursor/mapping (postgres_id → airtable_record_id),
  last_synced_at, for idempotent one-way upserts.

Relationships: Event 1—N Room, Track, Session, Embed. Session N—1 Room, N—1 Track, N—M
Speaker via SessionSpeaker, N—1 Submission (optional). Embed reads Sessions/Speakers through
its filters at render time (no snapshotting).

---

## User flows

### Organizer — build the agenda
1. Open Program > Agenda → List tab (empty state on first visit: "Nothing here yet").
2. Create rooms ("Main Stage", "Workshop Room A") and tracks ("MLOps", color purple) — inline
   from the Day-view grid or a small settings dialog.
3. Click "+ Add Session" → dialog/sheet: title, description, type, day + start/end time (or
   leave unscheduled), room, track, speakers multi-select (from accepted/confirmed speakers).
   Save as draft or published.
4. Switch to Day view → grid: time axis rows × room columns, day tabs Oct 12 / 13 / 14.
   Drag sessions between slots/rooms; resize to change duration; drag from the
   Drafts/unscheduled tray onto the grid to schedule.
5. On each drop, conflicts recompute: conflicting cards get red outline; Conflicts tab badge
   shows count.
6. Open Conflicts tab → list of conflict pairs ("Speaker Jane Doe is in 'LLM Evals' and
   'Agents 101', 14:00–14:30 overlap, Rooms A/B") → click to jump/fix.
7. Review Week / Track / Room views for balance; use List view + search/sort/filter for bulk
   review; publish sessions (individually or bulk).
8. (Cross-module) Accept a submission in Evaluation → "Add to agenda" creates a linked draft
   session carrying title/abstract/speakers.
9. Trigger Airtable export (button or scheduled) → sessions/rooms/tracks/speakers upserted to
   Airtable base.

### Organizer — publish embeds
1. Open CMS > Embeds → "+ Add Embed" → pick format/content type → editor.
2. Set name; keep Enabled on; pick content type (Schedule Itinerary or Speaker Gallery);
   optionally set filters (e.g. one track), style (accent color), field options.
3. Watch live Preview; flip desktop/mobile toggle to verify responsiveness.
4. Open "Get Code" → copy iframe/script snippet → paste into ai.engineer website.
5. Later edits to sessions/speakers appear on the website automatically (auto-update);
   toggling Enabled off blanks the embed.

### Speaker
1. Gets scheduled by the organizer; sees "My sessions" (time in event timezone, room) in the
   speaker portal, driven by SessionSpeaker rows (portal module renders it; this module
   supplies the query/contract).
2. Receives calendar invite for their slot (communications module consumes session
   starts_at/ends_at/room — schedule changes should be able to trigger updated invites).
3. Appears in the public speaker gallery once confirmed/published; their gallery detail lists
   their sessions.

### Reviewer
- No direct agenda interaction. Their accept decision feeds flow step 8 above (promote to
  session). Reviewer never sees drafts of the schedule.

### Public visitor
1. Visits ai.engineer page containing the embed (or the hosted public page directly:
   `/e/[event-slug]/schedule`, `/e/[event-slug]/speakers`).
2. Schedule: picks a day tab, filters by track/room, searches, expands a session for
   description + speakers; times shown in event timezone (labeled, e.g. "All times PDT").
3. Gallery: scrolls speaker grid, opens a speaker (or arrives deep-linked via
   `?sb-speaker-id=…`), sees bio + sessions, clicks through to the schedule.
4. Everything works on a phone (single-column collapse, tap targets, no horizontal scroll).

---

## Edge cases & bug traps

1. **Half-open intervals**: conflict check must treat `[start, end)` — a 10:00–10:30 and a
   10:30–11:00 session in the same room are back-to-back, not conflicting. Naive
   `startA <= endB && startB <= endA` flags them.
2. **Timezones**: store timestamptz; author/display in *event* timezone, never the browser's.
   An organizer in NYC editing a SF event must see SF times. Public embed must label the
   timezone. Don't build day tabs from UTC dates — "Oct 12" must be Oct 12 *in event tz*
   (a 9pm PT session is the next day in UTC; naive `DATE(starts_at)` grouping mis-bins it).
3. **Sessions with NULL times/room** (unscheduled tray, or "add later") must not crash Day/
   Week/Track/Room views or the conflict engine; they belong to List + Drafts only.
4. **Concurrent organizer edits**: two people dragging the same/overlapping sessions.
   Use optimistic concurrency (version/updated_at compare-and-set) → on conflict, refetch and
   show "schedule changed, reapply your move". Never last-write-wins silently. TanStack Query:
   invalidate agenda queries after every mutation; roll back optimistic updates on error.
5. **Drag-and-drop correctness**: snap-to-grid rounding must not silently change duration;
   resizing below minimum (e.g. 5 min) or to negative duration must be clamped; dropping on
   an invalid target reverts cleanly; touch devices at minimum must not break page scroll
   (DnD can be pointer-only, but view must remain usable on mobile).
6. **Deleting/renaming a room or track** that has scheduled sessions: block, or cascade to
   `room_id = NULL` (sessions become unscheduled-in-place) with a warning; never orphan FK
   rows. Same for removing a speaker who is on published sessions.
7. **Draft leakage**: public embed queries must filter `status = 'published'` (and confirmed
   speakers) at the query layer, not in the client — a single shared "publicSessions" query
   helper prevents an agent wiring a new embed type straight to the raw table.
8. **Enabled toggle must gate serving**: disabled embed URL should return an empty shell/404,
   not keep serving cached content.
9. **Embed caching vs auto-update tension**: aggressive edge caching makes the site fast but
   stale. Use short TTL (30–60 s) or tag-based revalidation on session/speaker mutations.
   On OpenNext/Cloudflare confirm ISR/revalidate actually works in the Workers adapter —
   fallback: `Cache-Control: s-maxage` + explicit purge. Test this early; it is the classic
   OpenNext gotcha.
10. **Framing headers**: Next.js/hosting defaults or a global middleware adding
    `X-Frame-Options: DENY` will silently kill the iframe embed on third-party sites. Embed
    routes need `frame-ancestors *` CSP and no XFO; admin routes should keep strict headers.
    Route-group the embed pages so the exception is scoped.
11. **Iframe height**: schedule length varies per day/filter; fixed-height iframe clips
    content. Script-injected iframe + postMessage resize, or generous min-height + internal
    scroll on the fallback plain-iframe snippet.
12. **Empty states everywhere**: event with no sessions (screenshot 1), no rooms (Day view
    needs ≥1 column or an inline "add a room" prompt), no tracks, no published sessions
    (embed shows "Schedule coming soon" — the preview screenshot shows exactly this state),
    speakers without headshots (initials placeholder), sessions without speakers (e.g. breaks
    should render without an empty speaker row).
13. **Multi-day + odd hours**: sessions spanning midnight (clamp or forbid — forbid is fine);
    events whose days have different active hours; grid should size to min/max session times
    per day, not fixed 9–5. DST transition during an event (Oct/Mar): compute times with the
    IANA zone, never fixed offsets.
14. **Conflict engine performance**: recompute per-day/per-event in one pass (sort by start,
    sweep) — O(n log n); don't run O(n²) checks in a React render loop, and don't run it
    client-side only: server should validate on write too so the Conflicts tab is
    authoritative.
15. **Speaker on the same session twice / duplicate assignment**: unique constraint on
    (session_id, speaker_id); UI multi-select must dedupe.
16. **Slug collisions** for public session/speaker URLs; regenerate with suffix.
17. **Airtable export**: 10 req/s and 10-records-per-request limits → batch + throttle;
    upsert idempotently via stored record-id mapping (re-running export must not duplicate
    rows); deletions in Postgres should mark/remove in Airtable or be explicitly documented
    as append/update-only. Never let an Airtable failure block the main app path (fire-and-
    forget job with status surfaced).
18. **Workers runtime limits**: OpenNext on Cloudflare — watch bundle size (keep DnD and
    grid libs client-side only), no Node-only APIs in server code paths (Neon over HTTP/
    websocket driver, not TCP pg), and keep the embed route's payload tiny for speed points.
19. **Query-param deep link** (`sb-speaker-id`) referencing a deleted/unpublished speaker
    must degrade to the gallery, not error.
20. **XSS via rich text**: session descriptions/bios rendered in public embeds must be
    sanitized (organizer-entered HTML/markdown ends up framed inside *someone else's* site).

---

## Simplifications (keep the brief's intent, drop Sessionboard's surface area)

1. **Views**: build exactly the brief's five — List, Day (the DnD surface), Week, Track,
   Room — plus a Conflicts tab. **Skip Month view** entirely. Week/Track/Room can be
   read-only projections of the same session data; DnD only on the Day grid (and optionally
   Week). This satisfies "viewable by list, day, week, track, or room" with one interactive
   surface.
2. **Skip Saved Views, Columns chooser, row density, Options menu, Invoices, Site, Studio,
   History, Reports** — none are in the primary features. Keep plain search + filter + sort.
3. **One track per session** (nullable FK), not many-to-many. Matches conference reality and
   halves the conflict logic.
4. **Two-state status** (draft/published) + "unscheduled" being simply NULL times — no
   separate Drafts subsystem; the "Drafts" button is just a filter for
   (status=draft OR starts_at IS NULL).
5. **Embed admin**: instead of a general five-format embed builder with Style/Filters/Field
   Options accordions, ship **two canonical public pages per event** — Schedule Itinerary and
   Speaker Gallery — at stable URLs (`/e/[slug]/schedule`, `/e/[slug]/speakers`, each also
   iframe-servable via `/embed/...` variants), plus a minimal "Embeds" admin screen that
   shows the copy-paste snippet, an enable/disable toggle, and 2–3 style options (accent
   color, light/dark, show-header). That covers the [CORE] requirement; the full configurator
   (arbitrary filters, field toggles, five content types) is [NICE] and can be added if time
   remains. Session List/Speaker List content types are the same components with a `variant`
   prop — cheap if wanted.
6. **Snippet strategy**: offer a plain `<iframe>` snippet first (zero-JS, always works), a
   script-tag auto-resizing variant second. Skip Sessionboard's "Locked" format-immutability
   concept entirely.
7. **Conflict detection = same-room overlap + same-speaker overlap** as errors; same-track
   overlap as a soft warning (or skip track-overlap if time-pressed — the brief's "across
   rooms and tracks" is satisfied by detecting conflicts for sessions across the room/track
   grid, i.e. room + speaker collisions). Derived at read/write time; no conflicts table.
8. **No recurring sessions, no session capacity/registration, no per-session ticketing** —
   out of scope.
9. **Public pages are also the embed** — one component tree, two shells (standalone page
   with site chrome; bare embed layout). One implementation satisfies "post to our website"
   both as a link and as an embed, and doubles as the demo URL for judges.
10. **Public JSON API for free**: the same server queries backing the public pages get
    exposed at `/api/v1/events/[slug]/schedule|speakers` (read-only, published data only) —
    claims the API bonus with ~zero extra logic.
11. **"Powered by" footer**: replace with a small OSS project credit or omit.
12. **Timezone**: single timezone per event (no per-viewer conversion toggle on the public
    schedule — just label it; wf2025 reference behaves this way). Store IANA name on Event.
13. **Deep-linking**: support `?speaker=<slug>` / `?session=<slug>` on our own pages via
    normal routing; the parent-page-query-param relay (`sb-speaker-id`) only if the script
    embed variant lands.

### Module boundaries / typed contracts (for parallel agents)

- `features/agenda`: owns Room, Track, Session, SessionSpeaker tables + conflict engine
  (pure function: `detectConflicts(sessions: ScheduledSession[]) → Conflict[]`, unit-tested
  first — it is the most bug-prone pure logic in the area). Exposes typed repository
  functions behind route handlers: session CRUD + `moveSession({id, version, startsAt, endsAt, roomId})`.
- `features/public-site` (or `features/embeds`): read-only consumer; imports only a typed
  `getPublishedSchedule(eventSlug)` / `getPublishedSpeakers(eventSlug)` query contract, never
  raw tables. Owns Embed config rows, embed routes, snippet generation, framing headers.
- `features/airtable-export`: consumes the same read contracts; owns sync-state mapping.
- Shared `packages/types` (or `lib/contracts`): zod schemas for Session/Speaker/Room/Track/
  Conflict DTOs — the inter-agent contract. Zustand only for ephemeral UI state (active view
  tab, drag state, selected day/filters); TanStack Query for all server state keyed
  `['agenda', eventId, ...]` with invalidation on every mutation.
