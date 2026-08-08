# M37 — Comms admin UI

| | |
|---|---|
| **Status** | IN PROGRESS — the merged fixture/localStorage **STACK-DEMO** communications UI lacks server queries/mutations, real templates/logs/reminders, and AC. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-F (Comms + Dashboard + Airtable + API) — feature folder `comms` (admin half). |
| **Scheduled** | **Tuesday** (moved off Monday — it gates nothing at CP3; [M27](./M27-speakers-admin.md) consumes fixture comms rows on Monday). |
| **Size** | M (≈half-day) |
| **Paths owned** | `src/features/comms/components/**`, `src/features/comms/hooks/**`, `src/features/comms/index.client.ts`, `src/features/comms/server/admin-mutations.ts`, `src/app/(admin)/events/[eventId]/comms/page.tsx`, `src/app/api/internal/comms/**`. Appends **only** its named export lines to `src/features/comms/index.ts` (owned by [M34](./M34-comms-outbox-dispatcher.md)). |

## Objective
`/events/[eventId]/comms` gives the organizer three tabs: **Templates** (the 8 fixed keys, subject + rich-text body with a variable picker and save-time validation), **Reminders** (the 3 ladder offsets), and **Log** (a filterable audit log with rendered ordinary messages and provider status; production `portal_login` credentials are redacted). A per-speaker "send reminder now" action closes the organizer loop from the dashboard. Preview-only fallback diagnostics never become a production auth bypass.

## Dependencies
- **Hard (blocks start):**
  - [M34](./M34-comms-outbox-dispatcher.md) — `renderTemplate`, **`validateTemplateBody(key, subject, body)`** (3 args — the subject is validated too, and this module's verification asserts it), `listLog`/`CommLogRow`, plus the sibling **`CommLogDetail`** (`CommLogRow & {bodyRenderedHtml, idempotencyKey, attempts}`) that the detail sheet loads separately, and `seedDefaultTemplates` (the rows this page edits).
  - [M05a](./M05a-admin-shell-ui.md) — `(admin)` layout + `DataTable`, `StatusBadge`, `EmptyState`, `ConfirmDialog`, `Dash`, `TzTime`.
  - [M03](./M03-db-schema-migrations.md) — `email_templates`, `reminder_rules`, `communication_logs` **incl. the ★ `body_rendered_html` column** (the log-detail view is meaningless without it).
  - [M04](./M04-shared-libs.md) — `defineHandler`, `sanitize()`, `api-client.ts`, `query-keys.ts`.
- **Soft (start against stub/fixture):**
  - [M05b](./M05b-rich-ui-primitives.md)'s `<RichTextEditor>` — if it is unavailable, ship a `<textarea>` with the same value contract (`string` of sanitized HTML) and swap the component import later; nothing else changes.
  - [M36](./M36-reminder-scan.md)'s `sendReminderNow` — until it lands, disable the button with a tooltip; the rest of the page is independent.
  - Log rows: use `scripts/seed/comms.ts`'s pre-populated log (queued / sent / failed / skipped rows across all 8 keys) — it exists from Saturday.

## Provides (interfaces others consume)
```ts
// src/features/comms/index.ts (appended)
export async function listTemplates(eventId: EventId): Promise<EmailTemplateRow[]>;                 // PROPOSED
export async function saveTemplate(eventId: EventId, key: TemplateKey,
  input: { subject: string; bodyHtml: string; enabled: boolean; expectedUpdatedAt: string }): Promise<EmailTemplateRow>; // PROPOSED
export async function listReminderRules(eventId: EventId): Promise<{ id: string; offsetDays: number; enabled: boolean }[]>; // PROPOSED
export async function saveReminderRules(eventId: EventId, rules: { offsetDays: number; enabled: boolean }[]): Promise<void>; // PROPOSED
export async function getLogDetail(eventId: EventId, logId: string): Promise<CommLogDetail>;         // PROPOSED — incl. bodyRendered
```
- Routes: `GET/PATCH /api/internal/comms/[eventId]/templates`, `GET/PUT /api/internal/comms/[eventId]/reminder-rules`, `GET /api/internal/comms/[eventId]/log`, `GET /api/internal/comms/[eventId]/log/[logId]`, `POST /api/internal/comms/[eventId]/send-reminder`.
- `<CommsLogTable eventId contactId?>` (client component, exported from `index.client.ts`) → embedded by [M27](./M27-speakers-admin.md)'s speaker detail as the per-speaker comms history (replacing its Monday fixture rows).

## Step-by-step implementation

1. **Contract-first slice.** Append the five signatures to the barrel (server fns real where trivial: `listTemplates`, `listReminderRules` are one query each) and create `index.client.ts` exporting `<CommsLogTable>` rendering `listLog` output. Tell WS-C that [M27](./M27-speakers-admin.md) can swap its fixture rows for `<CommsLogTable contactId={…}/>`.
   **Done when:** [M27](./M27-speakers-admin.md)'s speaker detail compiles against the real component and shows seeded rows.
2. **Page shell + tabs.** `src/app/(admin)/events/[eventId]/comms/page.tsx` — RSC, `force-dynamic`, `requireAdmin(eventId)`, three shadcn `<Tabs>`: `?tab=templates|reminders|log` (URL-synced, deep-linkable). Hydrate each tab's initial data as TanStack `initialData`.
   **Done when:** the sidebar "Comms" item navigates here and each tab deep-links.
3. **Templates tab.** Left rail of the **8** keys with an enabled/disabled dot: `submission_received`, `submission_accepted`, `submission_declined`, `task_assigned`, `task_reminder`, `schedule_assigned`, `schedule_changed`, **`portal_login`** (labels from the contracts enum, never re-spelled — render `TEMPLATE_KEYS.map(...)` rather than a hand-written list, so the rail cannot drift from the enum). Right pane: `Subject` input, `<RichTextEditor>` body, `Enabled` switch, `Save`.
   - **Variable picker**: a chip list built from that key's zod `TemplateVars` contract (see [M34](./M34-comms-outbox-dispatcher.md) step 3's table) — clicking a chip inserts `{{path}}` at the cursor. The picker is generated from the contract, never hand-listed.
   - **Live preview** panel: `renderTemplate(key, sampleVars)` against a fixture context, re-rendered on change, showing the rendered subject + HTML.
   - **Save**: `validateTemplateBody(key, subject, body)` first — unknown tokens render inline as `Unknown variable {{speaker.nickname}} — remove it or pick from the list`, and the save is **rejected client- and server-side**. Then `sanitize(bodyHtml)` server-side before the UPDATE (resolution #2 — organizer HTML never reaches an inbox raw). Optimistic concurrency via `expectedUpdatedAt` → 409 → "changed since you loaded".
   **Done when:** typing `{{speaker.nickname}}` blocks the save with the offending token named; pasting `<script>alert(1)</script><p>hi</p>` saves as `<p>hi</p>`; `curl -X PATCH` with an unknown token also 400s (the guard is server-side, not just disabled buttons).
4. **Reminders tab.** Three rows from `reminder_rules` rendered as "7 days before due / 1 day before due / 1 day after due" with enable switches and an editable integer offset; `saveReminderRules` replaces the set (`INSERT … ON CONFLICT (event_id, offset_days) DO UPDATE SET enabled`, delete removed offsets). Copy under the table explains the burst-safe rule in one sentence: *"Only the most recent applicable reminder is sent — a task that is already overdue gets one email, not three."*
   **Done when:** disabling the −7 rung and re-running `curl -XPOST …/api/jobs/reminders` produces no −7 rows; the copy is present (judges read it).
5. **Log tab.** `<DataTable>` over `listLog(eventId, filters)`: columns **Recipient** (contact name + email), **Template** (humanized key), **Status** (`<StatusBadge>`: queued grey / sent green / failed red / skipped amber), **Provider ID** (`<Dash>`), **Created**, **Sent** (`<TzTime>` in event tz with label). Filters: template key, status, free-text recipient. Newest first, page size 50. `<EmptyState title="No emails yet" hint="Emails appear here the moment a form is submitted or a decision is sent.">` for the empty second event.
   **Done when:** the seeded log renders with all four statuses and filtering by `status=skipped` shows the retired reminder rungs from [M36](./M36-reminder-scan.md).
6. **Log detail (audit + preview diagnostics).** Row click → sheet showing `subject_rendered`, the rendered ordinary body via `<RichTextView>` (the repo's only `dangerouslySetInnerHTML` site), the idempotency key, attempts, last error, and `ics_uid` when present. For `portal_login`, production shows `[credential redacted]` and no Copy-link action. Preview log mode may show/copy the credential only when `EMAIL_FALLBACK_UI=1`, clearly labeled development diagnostics; `docs/demo-script.md` must not present that as judge-path evidence.
   **Done when:** after dispatching a seeded `submission_accepted` row in preview log mode, its rendered detail shows a clickable portal magic link that actually logs a speaker in on the deployed preview.
7. **Send reminder now.** A per-row action on the log's per-speaker view and on [M27](./M27-speakers-admin.md)'s speaker detail: a small dialog listing that speaker's open assignments (from `task_assignments_v` via [M36](./M36-reminder-scan.md)) → `POST /api/internal/comms/[eventId]/send-reminder` → `sendReminderNow(...)` → toast + `nudgeOutbox`. `<ConfirmDialog>` before sending.
   **Done when:** clicking it twice in one minute produces one new log row; the email arrives (or is logged) within ~15 s thanks to the nudge.
8. **Polish pass.** Keyboard-reachable tabs, loading skeletons, error boundaries that hide a tab's panel rather than crashing the page, and one `docs/demo-script.md` paragraph mapping brief feature #3 to this URL.
   **Done when:** the page survives a deliberately broken `listLog` (temporarily throw) without a white screen.

## Acceptance criteria
**Catalog AC (verbatim):** editing a template with an unknown var shows the offending token; a template containing `<script>` is sanitized on save; log proves every send during the demo; spam-foldered mail is provably "sent, provider id X"; the rendered-body detail shows a usable magic link.

Verification:
- `pnpm vitest run src/features/comms/render.test.ts` (the `validateTemplateBody` cases this UI surfaces).
- `curl -X PATCH "$APP_BASE_URL/api/internal/comms/$EVENT/templates" -d '{"key":"task_reminder","subject":"x {{nope.var}}","bodyHtml":"<p>y</p>","enabled":true,"expectedUpdatedAt":"…"}'` → 400 with `unknownTokens:["nope.var"]`.
- `psql -c "select body_html from email_templates where key='submission_accepted'"` after saving a `<script>` payload → no `<script>`.
- Manual: Comms → Log → open the newest `submission_accepted` row → paste the copied link into a private window → the portal loads as that speaker.
- Playwright: `abstracts-decide.spec` ([M10](./M10-e2e-release.md)) already asserts exactly one comms-log row per notified submission; this page is where a human eyeballs it at CP4.

## Guardrails
- **`body_html` passes `sanitize()` on save** (resolution #2). The template editor is organizer-authored HTML that lands in judges' inboxes — this is the one place where skipping sanitization is a judged failure (risk #9).
- **Unknown-variable validation at SAVE time, never at send time** (analysis trap #9). A template that renders `undefined` in production is a P0; the renderer's loud failure is the backstop, not the plan.
- **`<RichTextView>` is the only `dangerouslySetInnerHTML` site in the repo** — CI greps for uniqueness. The log detail renders `body_rendered_html` through it, never inline.
- **Template rows are owned by `seedDefaultTemplates`** — this UI **updates** rows, it never inserts or deletes them, and it never creates a template for a key the enum does not contain.
- **Optimistic concurrency (R11)** on template saves: two organizers with the page open must get a 409, not silent last-write-wins.
- **No inline sending from UI/domain routes.** The "send reminder now" button *enqueues* and nudges; the dispatcher inside `sb-web` is the only Resend caller (CI grep). `sb-jobs` only triggers its route.
- **Event scoping**: every query/mutation signature starts with `eventId`; `defineHandler` supplies it from the route.
- Edge cases: brand-new event → **8** templates exist (7 domain keys + `portal_login`) but zero log rows → empty state, no NaN; production `portal_login` detail shows a redacted credential body; a `failed` row shows its error text truncated with a tooltip; a `skipped` row shows *why* (from `error`, e.g. `superseded rung (offset -7)` or `not in EMAIL_ALLOWLIST`) — judges ask; a log row whose contact was deleted cascades away, so the table must tolerate a missing join (`<Dash>`); very long rendered bodies scroll inside the sheet, never widen the page.
- **Cut-line awareness:** if Tuesday is tight, the Log tab + detail is the part that must ship (it is the audit/trust surface; preview-only fallback diagnostics are secondary); the template editor can degrade to read-only display of the seeded defaults, and the reminder-ladder editor to a static description of the three offsets.

## If blocked
- Blocked on [M05b](./M05b-rich-ui-primitives.md)'s editor: ship the textarea variant — the value contract is identical.
- Blocked on [M36](./M36-reminder-scan.md)'s `sendReminderNow`: build tabs 1, 2, 3 and 6 (that is the whole judged surface) and leave the button disabled.
- Blocked on [M03](./M03-db-schema-migrations.md)'s `body_rendered_html`: build the log table and detail against `subject_rendered` + a "body not captured" placeholder, and escalate the column to the architect immediately — it is a ★ delta that was supposed to land in 0000.
- Ahead of schedule / this module cut: move to [M39](./M39-airtable-export.md) (same Tuesday lane) or [M40](./M40-public-api.md)'s keyed endpoints, or extend `scripts/seed/comms.ts` so every status and every template key has at least one demo row.
