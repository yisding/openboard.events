# Sessionboard Clone — Next.js Application Architecture

Codename: **openboard** (placeholder; rename at will).
Deadline: Wed Aug 12, 10 PM PT. Executed largely by ~6 parallel AI coding agents.
Top priority: sound architecture and bug-resistant module boundaries; second: speed of delivery; third: bonus points (Cloudflare infra, Airtable export, speed, public API).

Non-negotiable stack (already decided): Next.js App Router · shadcn/ui + Tailwind · Neon Postgres (primary) + one-way Airtable export · OpenNext on Cloudflare Workers (`@opennextjs/cloudflare`) · Zustand (ephemeral UI state only) · TanStack Query (server state) · feature folders with typed contracts.

---

## 0. Decisions at a glance

| Concern | Decision |
|---|---|
| Repo shape | **Single Next.js app** (no monorepo). Boundaries enforced by ESLint, not package graph. |
| ORM / DB driver | **Drizzle ORM** with `neon-http` by default; per-request **`@neondatabase/serverless` WebSocket `Pool`** only in the eight audited `withTx()` functions named in `PLAN.md`. |
| Admin auth | **better-auth** (email+password, Drizzle adapter, Postgres sessions). Lucia is deprecated as a library; better-auth has a first-class Drizzle adapter and runs on Workers. |
| Speaker auth | **Custom magic-link tokens** (hashed, single-use, POST-confirm) → `portal_session` cookie scoped to (contact, event). NOT better-auth — speakers are not accounts, they're per-event contacts. |
| API style | **Route handlers only** — no Server Actions anywhere. One mutation mechanism, curl-testable, plays perfectly with TanStack Query. |
| Validation | **zod v4** schemas in `src/shared/contracts` — single source of truth for DB DTOs, API bodies, form runtime, and public API. |
| Rich text | **TipTap** editor (client-only), stores HTML, sanitized server-side on save via one shared `sanitize()` (the `xss` package — Workers-safe, no DOM). One editor component reused everywhere. |
| Drag & drop | **dnd-kit** (`@dnd-kit/core` + `@dnd-kit/sortable`) for agenda grid AND all list reordering. |
| Tables | TanStack Table v8 wrapped in one shared `<DataTable>`. |
| Email | **Resend HTTP API** through one plain-fetch adapter, env-gated (`EMAIL_MODE=log|send`). |
| ICS | Hand-rolled ~150-line builder, **UTC `Z` times** (no VTIMEZONE hand-rolling), stable UID + SEQUENCE, METHOD:REQUEST/CANCEL. |
| Charts | None. Stat tiles, CSS bars, one small SVG donut helper. (Speed bonus, zero bundle cost.) |
| File uploads | Direct-to-R2 via **presigned PUT** (aws4fetch against R2's S3 API); never proxy bytes through the Worker. |
| Scheduling | Cloudflare **Cron Trigger on a tiny separate worker** that POSTs `/api/jobs/{outbox|reminders|airtable|cleanup}` with `CRON_SECRET`. Idempotent scan design. |
| Cross-feature side effects | **`communication_logs` transactional outbox** written through `enqueueEmail()`; the web comms dispatcher consumes it. No direct provider calls from domain features. |
| Dates | `timestamptz` everywhere; event IANA timezone on Event; `date-fns` + `date-fns-tz` helpers only in `shared/lib/time.ts`. |
| IDs | `crypto.randomUUID()` PKs; per-event integer sequence for `SESS-n` codes. |

---

## 1. Repo layout

Single pnpm app. Everything under `src/`. **The strict rule:**

> A feature folder owns its DB tables, its server logic, its UI, and its routes' page components. Everything a feature exposes to the rest of the app goes through its `index.ts` (and `index.client.ts` for client components/hooks). Cross-feature imports may ONLY target `features/<x>` (the barrel) or `shared/*`. Deep imports (`features/<x>/server/...`) from another feature are an ESLint **error**.

> `shared/` is for code with **no feature-specific knowledge**: contracts (zod), UI primitives, pure utilities, db client, auth session helpers. If a file mentions "submission" business rules, it belongs to a feature; if it defines the Submission *shape/enum* that four features consume, it belongs to `shared/contracts`.

```
openboard/
├── package.json                  # single app, pnpm
├── next.config.ts                # headers() for /embed (frame-ancestors *), strict elsewhere
├── open-next.config.ts           # @opennextjs/cloudflare adapter config (R2 incremental cache)
├── wrangler.jsonc                # main worker: bindings (R2, secrets), routes
├── workers/
│   └── jobs/                     # tiny scheduled worker: POST /api/jobs/* (CRON_SECRET)
│       ├── index.ts
│       └── wrangler.jsonc        # one cron: ["* * * * *"], minute-modulo dispatch
├── drizzle.config.ts
├── eslint.config.mjs             # eslint-plugin-boundaries: feature isolation rules
├── scripts/
│   ├── seed.ts                   # demo event, tracks/rooms/formats, forms, submissions, speakers, tasks
│   └── check-contracts.ts        # tsc on shared/contracts alone (fast contract-drift check)
├── e2e/                          # Playwright smoke: golden path (CFP submit → accept → portal → schedule)
└── src/
    ├── middleware.ts             # security headers, admin-session gate for /events/*, portal gate
    ├── db/
    │   ├── client.ts             # neon-http db + confined per-request withTx Pool
    │   ├── schema/               # ONE file per feature; all re-exported by schema/index.ts
    │   │   ├── index.ts
    │   │   ├── auth.ts           # better-auth tables (or fallback admin_sessions)
    │   │   ├── core.ts           # users, events, members, files, tracks/rooms/formats/tags
    │   │   ├── contacts.ts       # contacts, portal_tokens/sessions, api_keys
    │   │   ├── forms.ts          # forms, sections, fields, versions, routing_rules
    │   │   ├── submissions.ts    # submissions, participants, answers, tags
    │   │   ├── evaluation.ts     # plans, criteria, assignments, reviews
    │   │   ├── portal.ts         # tasks/completions, responses, requests/uploads, resources
    │   │   ├── agenda.ts         # sessions, session_speakers
    │   │   ├── comms.ts          # templates, reminders, communication_logs outbox, invites
    │   │   ├── embeds.ts         # embeds
    │   │   └── airtable.ts       # airtable_sync_state + airtable_sync_runs
    │   └── views.ts              # typed rows for the eight SQL read-model views
    ├── shared/
    │   ├── contracts/            # ★ THE inter-agent contract surface. zod v4. No imports from features.
    │   │   ├── index.ts
    │   │   ├── enums.ts          # SubmissionStatus, SessionStatus, TaskStatus, TemplateKey, …
    │   │   ├── event.ts          # EventDTO, TrackDTO, RoomDTO, SessionFormatDTO
    │   │   ├── form-schema.ts    # FormSnapshot, FieldDTO, Condition/Visibility/Route, AnswerValue
    │   │   ├── submission.ts     # SubmissionDTO, SubmissionListRow, transition map
    │   │   ├── speaker.ts        # ContactDTO (profile shape gallery+portal+comms all read)
    │   │   ├── task.ts           # TaskDTO, lazy assignment DTO, OutstandingTasksRow
    │   │   ├── session.ts        # ScheduledSessionDTO, ConflictDTO, PublishedScheduleDTO
    │   │   ├── comms.ts          # TemplateVars, CommLogRow, idempotency recipes
    │   │   └── api.ts            # public API v1 response envelopes, ApiError shape
    │   ├── ui/                   # shadcn-generated components (components.json aliases here)
    │   │   ├── …(button, dialog, sheet, select, tabs, toast, …)
    │   │   └── app/              # OUR primitives built on shadcn (see §6)
    │   │       ├── data-table.tsx, status-badge.tsx, empty-state.tsx,
    │   │       ├── rich-text-editor.tsx, rich-text-view.tsx,
    │   │       ├── datetime-picker.tsx, tz-time.tsx, confirm-dialog.tsx,
    │   │       ├── file-upload.tsx (presigned R2), color-chip.tsx, stat-tile.tsx, donut.tsx
    │   ├── lib/
    │   │   ├── conditions.ts     # ★ evaluateVisibility(rules, answers) — ONE evaluator, client+server
    │   │   ├── sanitize.ts       # ★ sanitize(html) allowlist — the only path to rendering rich text
    │   │   ├── time.ts           # the 6-fn date-fns-tz API; sole wall-clock math owner
    │   │   ├── intervals.ts      # overlaps([start,end) half-open), sweep-line grouping
    │   │   ├── slug.ts           # slugify + the canonical 11 reserved words
    │   │   ├── api-client.ts     # api(path, outSchema, {method, body}) → zod-parsed, typed ApiError
    │   │   ├── query-keys.ts     # qk(feature, eventId, ...parts) key factory
    │   │   └── errors.ts         # AppError + closed code-to-HTTP mapping
    │   ├── server/
    │   │   ├── handler.ts        # defineHandler({auth, input, handler}) — the ONE way to write routes
    │   │   ├── enqueue-email.ts  # the only communication_logs enqueue helper
    │   │   ├── r2.ts             # presignPut/presignGet via aws4fetch
    │   │   └── cache.ts          # cacheTags + revalidate wrappers (see NEEDS-VERIFY §10)
    │   └── fixtures/             # typed fixture data matching contracts (consumers build before producers)
    ├── features/
    │   ├── auth/                 # better-auth config, admin login UI, api_keys mgmt, portal magic-link
    │   ├── events/               # event CRUD, branding, tracks/rooms/formats, settings hub
    │   ├── forms/                # CFP form builder + public CFP wizard runtime + routing rules
    │   ├── submissions/          # abstracts table, state machine, evaluation & scoring, notify
    │   ├── portal/               # speaker portal (home/profile/tasks), portal forms, file requests
    │   ├── agenda/               # sessions, DnD grid, conflict engine, views
    │   ├── embeds/               # public schedule/gallery pages, embed shells, snippet, embed config
    │   ├── comms/                # templates, outbox consumer, reminder ladder, ICS, comm log
    │   ├── dashboard/            # read-only widgets over db/views.sql
    │   └── airtable/             # one-way idempotent export
    └── app/                      # routes are thin: import page components from features
        ├── layout.tsx, globals.css               (architect-owned)
        ├── (admin)/ …                            (see route map §2)
        ├── (portal)/ …
        ├── (public)/ …
        ├── (embed)/ …
        ├── api/internal/<feature>/**/route.ts    # owned by that feature's agent
        ├── api/v1/**/route.ts                    # public API (owned by comms/API agent)
        ├── api/uploads/presign/route.ts
        ├── api/jobs/{outbox,reminders,airtable,cleanup}/route.ts
        └── cal/[token]/route.ts                  # tokenized ICS download (no auth)
```

### Inside a feature (fixed convention)

```
features/<name>/
├── index.ts            # server-safe public API: query fns, mutation fns, types re-exports
├── index.client.ts     # public client API: components + hooks other features may embed
├── server/
│   ├── queries.ts      # read fns — EVERY fn takes eventId as FIRST arg (no default)
│   ├── mutations.ts    # write fns — throw typed AppError; only named paths open withTx
│   └── guards.ts       # feature-specific invariants (state machine, locked fields, …)
├── components/         # React components (RSC + client)
├── hooks/              # TanStack Query hooks + keys.ts + invalidate helpers
├── store.ts            # Zustand store(s) — ephemeral UI state only (may be absent)
└── fixtures.ts         # optional feature-local fixtures for its own tests
```

**DB access rule:** a feature imports Drizzle tables only from its own `db/schema/<feature>.ts`. Reading another feature's data = call that feature's exported query fn. Two explicit exceptions: (1) `dashboard` reads cross-feature data through the `dashboard_*` SQL views only; (2) `airtable` reads through other features' exported read contracts only.

**ESLint enforcement** (`eslint-plugin-boundaries` + `no-restricted-imports`): `features/A/**` may import `shared/**`, `db/schema/A`, `features/B` (barrel only). `shared/**` may import nothing from `features/**` or `db/**` (except `shared/server` may import `db/client`). `app/**` may import feature barrels only. CI fails on violation — this is the merge-hell firewall.

---

## 2. Route map (all surfaces)

Admin routes are keyed by `eventId` (uuid); all public/portal surfaces are keyed by `eventSlug` (pretty URLs, matches Sessionboard's `/submit/{event-slug}/{form-uuid}`).

### 2.1 Admin app — route group `(admin)`, full auth (better-auth session)

| Route | Feature | Notes |
|---|---|---|
| `/login` | auth | better-auth email+password; seed creates organizer + reviewer users |
| `/events` | events | event list + create (event switcher target) |
| `/events/[eventId]` | dashboard | redirect → `/dashboard` |
| `/events/[eventId]/dashboard` | dashboard | tabs `?tab=today\|speakers` (Speaker Tracking = CORE) |
| `/events/[eventId]/submissions` | submissions | status tabs `?status=`, search/filter/sort; detail drawer `/submissions/[submissionId]` (parallel route or sheet w/ shallow URL) |
| `/events/[eventId]/evaluation` | submissions | plans CRUD, reviewer assignment, progress |
| `/events/[eventId]/review` | submissions | reviewer queue (role=reviewer sees only this + submissions read) |
| `/events/[eventId]/forms` | forms | forms list (Open/Closed tabs, counts) |
| `/events/[eventId]/forms/[formId]` | forms | builder: left step rail `?step=setup\|welcome\|abstract\|participant\|settings\|notifications`; Save/View Form/Copy Link |
| `/events/[eventId]/agenda` | agenda | `?view=list\|day\|week\|track\|room\|conflicts&day=YYYY-MM-DD` — Day is the DnD surface |
| `/events/[eventId]/speakers` | portal | contacts table (accepted speakers, missing bio/headshot filter) |
| `/events/[eventId]/speakers/[contactId]` | portal | profile + comms history + "Open portal as" impersonation link |
| `/events/[eventId]/tasks` | portal | tasks CRUD (kinds manual/form/file), completion matrix |
| `/events/[eventId]/tasks/forms/[formId]` | portal | portal-form builder (single page, not wizard) |
| `/events/[eventId]/comms` | comms | 8-template editor (7 domain + `portal_login`), reminder ladder, communication log table |
| `/events/[eventId]/embeds` | embeds | snippet + enable toggle + minimal style options, live preview |
| `/events/[eventId]/settings` | events | tabs: Details+branding · Tracks · Rooms · Formats · API keys · Airtable |

Middleware gates `/events/*` on an admin session; per-event role check (`organizer` vs `reviewer`) in `requireAdmin(eventId, role?)`.

### 2.2 Public CFP — route group `(public)`, no auth to view

| Route | Feature | Notes |
|---|---|---|
| `/submit/[eventSlug]/[formId]` | forms | 5-step wizard (Welcome → Account → Submission → Participant → Review); step synced to `?step=` + history; branded (logo/background); deadline+limit banner; closed → friendly closed page |
| `/submit/[eventSlug]/[formId]/done` | forms | success page (custom message, "make sure this works"), Continue-to-portal + 10s auto-redirect |

Account step: email + OTP code (6-digit, emailed) — code entry avoids the cross-device magic-link problem mid-wizard; creates/loads the Contact and sets the portal session cookie, so CFP identity **is** the portal login.

### 2.3 Speaker portal — route group `(portal)`, magic-link/OTP session

| Route | Feature | Notes |
|---|---|---|
| `/portal/[eventSlug]` | portal | Home: My Submissions / My Profile / Tasks widgets |
| `/portal/[eventSlug]/login` | auth | email → magic link + OTP fallback; link lands on `/verify?token=` page whose **button POSTs** to consume (email-scanner-safe) |
| `/portal/[eventSlug]/submissions` (+`/[id]`) | portal | statuses (never expose queue states — map accept_queue/decline_queue → "Pending") |
| `/portal/[eventSlug]/profile` | portal | bio (5,000-char), names/pronouns, links, headshot upload |
| `/portal/[eventSlug]/tasks` (+`/[assignmentId]`) | portal | grouped My Tasks / per-submission; manual complete, form fill, file upload |
| `/portal/[eventSlug]/resources` | portal | wiki pages (sanitized HTML embed support) — CORE per brief |

**Auth model justification.** Admins/reviewers need real accounts, roles, and long-lived sessions → **better-auth** (actively maintained, Drizzle adapter, documented Cloudflare Workers/OpenNext deployments; Lucia's author deprecated it as a package). Speakers must click a link in an email and be in — no password, no signup friction; their identity is a per-event Contact row, not a user account. A 60-line token table (hashed token, expiry, single-use, POST-confirm) + signed cookie `{contactId, eventId, impersonatedBy?}` is less code than bending a full auth library to per-event scoping, and gives us admin impersonation ("Open portal as X") for free. Same session is set by the CFP Account step, satisfying "CFP account becomes portal login."

### 2.4 Public site + embeds — route groups `(public)` and `(embed)`

| Route | Feature | Notes |
|---|---|---|
| `/e/[eventSlug]/schedule` | embeds | canonical public schedule itinerary (wf2025.ai.engineer/schedule style); day tabs, track filter, `?session=` deep link; published sessions only; "All times PDT" label |
| `/e/[eventSlug]/speakers` | embeds | speaker gallery grid; `?speaker=` deep link → bio + their sessions |
| `/embed/[eventSlug]/schedule` · `/embed/[eventSlug]/speakers` | embeds | same components, bare shell; `frame-ancestors *`, no XFO; inline script posts height via postMessage |

`next.config.ts` `headers()`: `/embed/:path*` gets `Content-Security-Policy: frame-ancestors *` and strips `X-Frame-Options`; everything else keeps strict headers. Embed pages are the auto-updating deliverable: cached with short TTL (§10).

### 2.5 Public REST API — `/api/v1`, bonus points

Envelope: `{ data, meta? }` / `{ error: { code, message } }` (shapes in `shared/contracts/api.ts`). Auth: `Authorization: Bearer ob_live_…`; keys hashed in `api_keys` (created in Settings → API keys). **Published data is public without a key** (it's already on the public pages — and this doubles as the embed data source); everything else requires a key.

| Endpoint | Auth | Backing contract |
|---|---|---|
| `GET /api/v1/events/[slug]` | none | `events.getEventBySlug` |
| `GET /api/v1/events/[slug]/schedule` | none | `agenda.getPublishedSchedule` |
| `GET /api/v1/events/[slug]/speakers` | none | `portal.getPublishedSpeakers` |
| `GET /api/v1/events/[slug]/submissions?status=` | key | `submissions.listForApi` |
| `GET /api/v1/events/[slug]/speakers/outstanding-tasks` | key | `portal.getOutstandingTasksView` |
| `GET /api/v1/events/[slug]/stats` | key | dashboard read model |
| `GET /api/v1/events/[slug]/comms-log` | key | `comms.listLog` |

### 2.6 Utility routes

- `POST /api/uploads/presign` — auth'd (admin or portal); validates kind/mime/size; returns R2 presigned PUT + final object key; DB row written on the subsequent "attach" mutation.
- `POST /api/jobs/{outbox|reminders|airtable|cleanup}` — `x-cron-secret` header; each route delegates to one bounded, idempotent feature function or a guarded no-op stub.
- `GET /cal/[token]` — tokenized ICS download (calendar clients fetch with no cookies).
- `/api/internal/<feature>/**` — the app's own client↔server API (admin/portal session auth). Never documented publicly; free to change.

---

## 3. Data-flow conventions (the agent rulebook)

Four rules; violations are review-blockers:

1. **Initial render = Server Components.** Every page RSC calls the owning feature's `server/queries.ts` directly (no HTTP hop) and passes typed DTOs down. Pages that need interactivity hydrate those DTOs as `initialData` into TanStack Query.
2. **All client reads/refetch = TanStack Query** via `api-client.ts` against `/api/internal/...` GET handlers. Keys from the shared factory: `qk('agenda', eventId, 'sessions', {day})`. Defaults: `staleTime: 15_000`, `refetchOnWindowFocus: true` — this IS our "real-time" dashboard story (plus 30s `refetchInterval` on the dashboard page only).
3. **All mutations = TanStack `useMutation`** → POST/PATCH/DELETE `/api/internal/...` route handlers built with `defineHandler({auth, input: zodSchema, handler})`. Handlers zod-parse input, check auth + eventId scope, run the feature mutation, and return the canonical data/error envelope. Every mutation hook calls its feature's exported `invalidateX(queryClient, eventId)` helper. Optimistic updates only where specified (agenda drag, status badge); always with rollback on error. **No Server Actions** — one mechanism, uniform auth/validation, trivially curl-testable, no serial-action queueing, no OpenNext action edge cases.
4. **Zustand = ephemeral UI state only.** Litmus test: *"If the server could ever need this value to be correct, it is not Zustand state."* Allowed: CFP wizard step + in-progress answers before submit (persisted to localStorage keyed by formId, cleared on submit), agenda drag ghost/active view/day, table filter+column prefs (localStorage), builder panel open/selected-field. Forbidden: anything fetched from the server, anything another user could change, derived server data. Zustand stores never contain a fetch; TanStack Query caches never feed Zustand.

Concurrency convention: every mutable row carries `updated_at`; edit mutations send `expectedUpdatedAt` and return **409** on mismatch (`defineHandler` supports it natively); UI shows "changed since you loaded — refresh". Agenda `moveSession` uses an integer `version` compare-and-set.

Event scoping convention: **every** query/mutation fn signature starts `(eventId: string, …)`; every unique index includes `event_id`; `defineHandler` resolves eventId from the route and passes it — an agent physically cannot forget it.

---

## 4. Database & shared contracts

- **Drizzle + Neon**: `db` uses `drizzle-orm/neon-http` for every read and single-statement write. `withTx()` creates and closes a `@neondatabase/serverless` WebSocket `Pool` only for the eight audited runtime functions named in PLAN resolution #4. Use the pooled Neon runtime URL; keep `DATABASE_URL_DIRECT` off Workers. NEEDS-VERIFY: execute a transaction through the deployed OpenNext artifact before any feature relies on it; the fallback rewrites those eight paths as guarded CTEs on `neon-http`.
- **Schema ownership**: one schema file per feature, all written by the architect agent during Phase 0 (the entity model is already fully specified by the six analyses). After CP1 the schema is **frozen**; changes go through the architect only (single-writer on `db/schema/**` + `db/migrations/**` kills the worst merge-conflict class).
- **Canonical enums live in `shared/contracts/enums.ts`** and are imported by the Drizzle schema (pgEnum) — one definition. The big one: `SubmissionStatus = draft | pending | accept_queue | accepted | decline_queue | declined | withdrawn` with the legal-transition map and `canTransition(from, to)` exported beside it; consumed by submissions (state machine), forms (intake), portal (display mapping), agenda (promotion filter), embeds/airtable (accepted-only filters), comms (triggers).
- **Contracts-first**: `shared/contracts` compiles standalone (`scripts/check-contracts.ts`); DTOs are zod schemas with inferred types. Where cheap, `drizzle-zod` derives the base and contracts refine. Fixtures in `shared/fixtures` are zod-parsed at test time so fixture drift fails CI.
- **Sanitization**: rich text is sanitized **on write** in mutations (`sanitize()` from `shared/lib/sanitize.ts`, `xss` allowlist: p, headings, b/i/u, ul/ol/li, a[href http(s)], br, blockquote, img[src] only for resource pages) and rendered only through `<RichTextView>` (which sanitizes again — belt and braces; stored-XSS from public CFP input is a judged failure mode). Char limits count text content (strip tags → count code points) — same helper client and server.
- **Conditions/routing**: `ConditionRule = { match: 'all'|'any', conditions: [{ fieldId, op: eq|neq|in|answered|empty, value }] }` in contracts; `evaluateVisibility()` in `shared/lib/conditions.ts` is the ONE evaluator used by the wizard (live show/hide), the submit handler (discard hidden answers, validate only visible+required), and the builder preview. Routing rules re-use the same condition shape, ordered first-match, referencing option **ids** not labels, with an Uncategorized fallback.

---

## 5. Feature public interfaces (contract-first stubs)

These signatures are written as throwing stubs in Phase 0 so consumers compile on day one; fixtures make them return demo data until real implementations land.

- **events** — `getEvent(eventId)`, `getEventBySlug(slug)`, `listTracks(eventId)`, `listRooms(eventId)`, `listFormats(eventId)`; client: `<EventSwitcher>`, `<TrackChip>`.
- **forms** — `getPublicForm(eventSlug, formId)` (form schema + open/closed + limit state), `listForms(eventId)`; client: `<FormFieldRenderer>` (shared by CFP wizard AND portal forms — portal forms simply pass no conditions).
- **submissions** — `createSubmission`, `upsertDraft`, `updateSubmissionFromCfp`, `transitionStatus`, `notifyQueues`, `getAcceptedForScheduling`; all submission inserts stay in this feature.
- **portal** — `getSpeakerProfile`, `getOutstandingTasksView`, `ensurePortalSession`, and the three task-completion functions; contact writes use the feature's scoped helpers.
- **agenda** — `getPublishedSchedule(eventSlug)`, `detectConflicts(sessions): Conflict[]`, `moveSession`, `promoteSubmission`; schedule mail is enqueued through the shared helper.
- **comms** — `dispatchOutbox`, `renderTemplate`, `validateTemplateBody`, `seedDefaultTemplates`, `listLog`; domain features depend only on shared `enqueueEmail` plus contract key builders.
- **embeds/dashboard/airtable** — consumers only; export their page components.

**The outbox pattern (why):** features insert a `communication_logs` row through `enqueueEmail` in the same transaction as a domain change when atomicity matters. `UNIQUE(idempotency_key)` makes insertion the double-send firewall. The web dispatcher claims queued rows, rebuilds context from ids, re-checks current truth, renders, sends through the sole Resend adapter, and marks the row terminal/retryable. Reminders are discovered by the `%15` live scan rather than pre-scheduled. ICS uses stable UID + monotonic SEQUENCE per `(contact, session)`; reschedule bumps SEQUENCE and unschedule sends METHOD:CANCEL.

---

## 6. shadcn/ui conventions

- Generate via CLI into `src/shared/ui` (`components.json` aliases: `ui → @/shared/ui`, `utils → @/shared/lib/cn`). Generated files are **never** edited except through `shared/ui/app/*` wrappers — regeneration stays safe, and agents share one look.
- Components every agent must use (building their own duplicate is a review-blocker): `<DataTable>` (TanStack Table: sorting/filtering/pagination/row-selection/column-visibility — powers abstracts, agenda list, comm log, speakers, uploads), `<StatusBadge status={SubmissionStatus}>` (colors defined once beside the enum), `<EmptyState icon title hint action?>` (screenshots show 10+ designed empty states — this is cheap parity), `<RichTextEditor>`/`<RichTextView>`, `<DateTimePicker tz={event.timezone}>` (renders + parses in event tz, shows tz label, clearable), `<TzTime>`, `<FileUpload>` (presigned R2 with progress), `<ConfirmDialog>`, `<StatTile>`, `<Donut>`.
- Forms: `react-hook-form` + `zodResolver` with shadcn `<Form>` primitives; the zod schema is imported from contracts (client and server validate the same schema).
- Theming: default shadcn theme + one accent CSS variable per event (from event branding) applied on public/portal/embed layouts. Light mode only (cut dark-mode QA).
- Admin chrome: one `(admin)` layout — sidebar (event switcher, nav: Dashboard / Program: Submissions·Forms·Evaluation·Agenda / Portal: Speakers·Tasks / Comms / Embeds / Settings), topbar (View Portal, user menu). Built once by the events agent; others plug pages in.

### Drag-and-drop: dnd-kit (decision + justification)

**Choice: `@dnd-kit/core` + `@dnd-kit/sortable` (+ `@dnd-kit/modifiers`) everywhere** — agenda Day grid, unscheduled tray, form-builder field reorder, column-preference reorder.

- vs **react-beautiful-dnd / hello-pangea**: list-only model — cannot express a 2-D time×room grid or edge-resize; rbd is officially unmaintained.
- vs **Atlassian pragmatic-drag-and-drop**: excellent and framework-agnostic, but lower-level (raw DOM adapters), less React-idiomatic; more glue code for the same result under time pressure.
- vs **FullCalendar (resource timeline)**: would gift us the grid, but resource-timeline is a paid ("premium") plugin, theming to shadcn is painful, and it fights React state. Not acceptable for an OSS deliverable.
- dnd-kit fits exactly: headless (we own the grid markup = easy shadcn styling), pointer+keyboard+touch sensors, `snapToGrid`-style modifiers for 15-min increments, sortable preset for the list reorders, small bundle, no DOM assumptions that break under RSC (all DnD components are `"use client"`).

Agenda grid design: CSS grid, rows = 15-min slots computed in event tz (`shared/lib/time.ts` builds the day's slot list — DST-safe), columns = rooms. A session card is a draggable positioned by `grid-row: start / end`; drop target = (room column × slot); resize = two thin draggable edge handles adjusting start/end with min-duration clamp. On drop: optimistic move → `moveSession` (version CAS) → on 409 rollback + toast + refetch. `detectConflicts` runs client-side on the optimistic state for instant red outlines AND server-side on write (authoritative, feeds the Conflicts tab badge). Half-open `[start, end)` semantics from `shared/lib/intervals.ts`.

---

## 7. Parallel-agent execution plan (~6 agents, no merge hell)

### Ownership map (hard boundaries — an agent writes ONLY in its cells)

| Agent | Features | app/ routes | db/schema files (Phase 0 authored, then frozen) |
|---|---|---|---|
| **A0 Architect** (first 6–8h, then integrator) | shared/*, db/*, auth, scaffold, CI, seed | root layout, middleware, login | all (initial) |
| **A1 Events+Forms** | events, forms | (admin) events/settings/forms, (public) submit | events.ts, forms.ts |
| **A2 Submissions** | submissions | (admin) submissions/evaluation/review | submissions.ts |
| **A3 Portal** | portal | (portal)*, (admin) speakers/tasks | portal.ts |
| **A4 Agenda+Embeds** | agenda, embeds | (admin) agenda/embeds, (public) e/*, (embed)* | agenda.ts, embeds.ts |
| **A5 Comms+Dashboard+API** | comms, dashboard, airtable | (admin) comms/dashboard, api/v1, api/jobs, cal, workers/jobs | comms.ts, airtable.ts, views.sql |

Six workstreams; if only five agents run, A5 splits last (dashboard is read-only and slips gracefully). Every cross-agent dependency crosses a contract that exists as a stub from hour ~6.

### Mechanics

1. **Contract-first Phase 0** (architect, Fri night): scaffold app + OpenNext deploy walking skeleton ("hello" page live on workers.dev), full Drizzle schema, all `shared/contracts`, throwing stubs for every `index.ts` signature in §5, fixtures, seed script, shared UI primitives (DataTable/StatusBadge/EmptyState/RichTextEditor/DateTimePicker), better-auth wired, ESLint boundaries, CI (typecheck + lint + build + contract check). Then **contracts freeze**: changing `shared/contracts` or any `index.ts` signature requires a note in `CONTRACTS.md` + architect merge — the change itself stays cheap, silent drift becomes impossible.
2. **Trunk-based, rebase-often**: each agent on a long-lived branch, rebases onto main ≥2×/day, merges only green CI. File-level ownership above means textual conflicts are near-zero by construction; the only shared hot files (`schema/index.ts`, root layout, `globals.css`) are architect-owned.
3. **Consumers build against fixtures**: e.g. A5's dashboard renders `shared/fixtures/outstandingTasks.ts` through the real contract type until A3's query lands; swap is a one-line import change. Graceful degradation rule: a widget whose backing view errors hides itself rather than crashing the page.
4. **Integration checkpoints** (demo-or-it-didn't-happen; architect drives, on the deployed preview URL):
   - **CP1 — Sat noon**: schema migrated on Neon, seed data loads, admin login works, every route renders (stub pages fine), deploy pipeline green.
   - **CP2 — Sun night**: **golden path** e2e on preview: create event → build form (conditions + routing) → public CFP submit → abstract appears pre-tagged → accept → outbox email logged → magic link → portal shows task. This is the brief's spine; everything after is additive.
   - **CP3 — Mon night**: agenda DnD + conflicts + promotion; schedule/gallery public pages + embed iframe verified inside a scratch host page; comms triggers + reminder cron + ICS imported successfully in **Gmail and Outlook** (real test); dashboard Speaker Tracking live.
   - **CP4 — plan-Tue / Wed Aug 12 by 2 PM**: release proof first; public API and Airtable remain deferred until the minimum loop is green.
   - **plan-Wed / Wed Aug 12 after 2 PM**: freeze, bug bash on judge flows, submit by 8 PM PT with a 2-hour emergency buffer.
5. **Definition of done per module**: zod-validated handlers; empty states; event-tz rendering; sanitized rich text; invalidation helpers wired; seed data exercises it; one Playwright smoke touching it.

---

## 8. Dashboard read model

`drizzle/0001_views_triggers.sql` defines the eight canonical read views, including the one counting rule: `submission_status_counts_v`, `submission_ratings_v`, `accepted_speakers_v`, `task_assignments_v`, `speaker_outstanding_v`, `missing_assets_v`, `published_sessions_v`, and `published_speakers_v`. Drafts remain visible as their own status count while the top-level Submissions KPI excludes them. The dashboard fetches **one** aggregated endpoint (`/api/internal/dashboard/[eventId]/overview`) — no widget-per-query waterfall — and public `/stats` reuses the same view-backed definitions.

---

## 9. Cloudflare/OpenNext specifics

- `@opennextjs/cloudflare` with `nodejs_compat`; R2 bindings `FILES` and `NEXT_INC_CACHE_R2_BUCKET`. [`../environments.md`](../environments.md) is authoritative for variables and secrets: notably `SESSION_SECRET` (not `AUTH_SECRET`) and `AIRTABLE_API_KEY` (not `AIRTABLE_TOKEN`). Preview and production have isolated workers, DBs, buckets, and secrets.
- Uploads: presigned PUT to R2 via `aws4fetch` (Workers request-body limits make proxying fragile); orphaned objects tolerated for the hackathon (attach-on-mutation means DB is never wrong).
- Caching strategy (speed bonus vs correctness): public schedule/gallery/embed + JSON API: `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` — auto-update within a minute satisfies "auto-updating" with zero invalidation machinery. CFP page: `s-maxage=30` BUT open/closed + deadline banner computed server-side per request against `closesAt` (the cached shell may be 30s stale; the submit handler is always authoritative). Admin/portal: no edge caching.
- Cron: `workers/jobs` scheduled worker (`* * * * *`) uses minute modulo and POSTs the matching `/api/jobs/*` routes. It receives only `APP_BASE_URL` and `CRON_SECRET`; all job logic and service credentials stay on the web worker.

---

## 10. NEEDS-VERIFY list (check before CP2, each has a fallback)

1. **better-auth on OpenNext/Workers** with Drizzle+Neon — verify session cookie flow on the deployed preview in Phase 0 (it's the walking skeleton's job). Fallback: hand-rolled sessions table + scrypt via WebCrypto (we already build exactly this for the portal).
2. **`revalidateTag`/ISR behavior under `@opennextjs/cloudflare`** — we deliberately do NOT depend on it (s-maxage strategy above); verify only if we want instant embed updates. 
3. **Neon Pool-per-request on Workers under burst** (deadline-minute submits) — load-test with 50 concurrent submits at CP2; fallback: rewrite the eight audited runtime paths as guarded CTEs on `neon-http`.
4. **ICS acceptance in Gmail + Outlook** (METHOD:REQUEST attachment, UTC Z times, ORGANIZER on our verified Resend domain; SEQUENCE bump on reschedule; CANCEL) — real-inbox test at CP3. Fallback: "Add to calendar" download link only (still satisfies "iCal").
5. **Resend domain verification** — start DNS verification Fri night (propagation latency); until verified, `EMAIL_MODE=log` and the comms log UI proves sends.
6. **`xss` package under Workers** — smoke-test in Phase 0; fallback: tiny hand-rolled allowlist sanitizer over `HTMLRewriter` or regex-free tokenizer (we control the editor, so input HTML is near-well-formed; still sanitize).
7. **dnd-kit touch behavior on the Day grid** (mobile admin is non-goal, but must not break page scroll) — pointer-sensor with activation constraint; verify on a phone at CP3.
8. **Sessionboard walkthrough video** (linked in brief) — re-check CFP steps 2–5 field sets, Accept/Decline-queue notify semantics, and the conditional-logic UX judges expect; our designs for those are inferred (flagged in analyses). Adjust copy/fields, not architecture.

---

## 11. What we are explicitly NOT building

Payments step (annotated NOT NEEDED) · Accelevents (waived) · AI review (very optional — at most one "Generate AI review" button writing a synthetic reviewer Score at CP4+) · Group/sponsor targets · custom dashboard builder / AI-prompt dashboards · Month view · Saved Views beyond localStorage · Email themes/Record settings/Personas/CRM/Marketing/Studio/Invoices · websockets (polling is "real-time" here) · OAuth calendar APIs (ICS covers Gmail/Outlook/iCal) · multi-org tenancy (single team, multi-event via `event_id` everywhere).
