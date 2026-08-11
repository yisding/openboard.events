# openboard — plan folder

**Codename:** openboard (Sessionboard clone) · **Deadline:** Wed Aug 12, 10:00 PM PT (submit by 8 PM PT — deliberate 2h buffer)

This folder is the execution surface for the build. It contains one **work order per module** plus the schedule that says who runs what, when.

> **Current rebaseline (rev. 12, Mon Aug 10 afternoon):** **PR #95 merged** (status §2g) — under explicit owner re-authorization of the M42 hold, one orchestrated run landed the whole P4 commercial chain: M42 Better Auth + Google admin auth with revocable sessions and PBKDF2 rehash-on-login, M43 organization tenancy with default-org backfill, M44 user management + invitations + audit, M45 self-serve onboarding, M47 GDPR export/erasure/retention, and M49 billing scaffold — plus M55 Speaker CRM's server/API core (no UI yet), six additive migrations (`drizzle/0009`–`0014`) applied to `sb-dev`/`sb-test` after a migration-batch-transaction fix, the last five deployed e2e failures, and the embed-cache regression (embeds are ISR again). M50/M52 also got finish passes down to deployed-evidence-only remainders. No module is `DONE` under the evidence rules — what remains is the deployed verification queue (redeploy, smoke, a full Playwright rerun, then the deployed demonstration queue including the M42 S4 redo, external email evidence, and production provisioning) and a much smaller code queue (M50/M52/M55 deployed-evidence remainders only; P6 not started) (status §6). Read [`status.md`](status.md) (§2c–§2g are the ledger); the product overlay is [`product-roadmap.md`](product-roadmap.md). The original wave table remains the dependency choreography.

## Authority order (read this before you argue with anything)

1. **[`../PLAN.md`](../PLAN.md) is LAW.** Its 23 front-matter conflict resolutions, its §2 invariant list, its §4 module catalog, its §5 dependency graph, its §6/§7 schedule, and its §9 cut lines override every other document, including this one and including your module work order. Where PLAN.md spells out a signature or a rule, copy it **exactly**; never invent a conflicting one. **Precedence note (rev. 8):** while the recovery gates are open, PLAN §9's cut lines govern same-day scope decisions; after R3 exits, [`product-roadmap.md`](product-roadmap.md) governs the product-completeness modules and remaining roadmap items. Naming reconciliation: the audited notify function shipped as **`notifyQueues`** (PLAN's `notifyDecisions` is its internal `withTx` body — see M18's work order); read the frozen lists accordingly.
2. **[`status.md`](status.md)** — the current evidence ledger and recovery overlay. It selects the next recovery gate without changing scope, contracts, or dependency edges. Read it at the start of every work session and after any merge.
3. **[`environments.md`](environments.md)** — the canonical environment, binding, and secret placement. It is authoritative only for provisioning and cannot change product scope.
4. **[`execution.md`](execution.md)** — the parallel schedule: dependency graph, wave table, checkpoints, stub-first cold starts, cut lines. Its rebaseline overlay plus `status.md` determine what may run now; the original wave table shows intended parallel choreography once gates reopen.
5. **`modules/<id>-*.md`** — your work order. Self-contained by construction: an agent should be able to implement a module from its work order + `PLAN.md` + the two or three design docs it names, without reading every other work order.
6. **`design/*.md`, `analysis/*.md`** — reference detail (DDL, layout, platform specifics, per-screen UI facts). Consult on demand; they are *sources*, not decisions. Where a design doc contradicts PLAN.md, PLAN.md wins.

---

## 1. The 7-agent execution model

Seven agents work in parallel from Saturday morning. Six lanes, seven agents — **WS-B (the critical path) runs two agents**, B1 (builder) and B2 (public runtime), split from Sat AM because the wizard renders *snapshots*, not the builder.

| Lane | Agent | Owns (folders / route files) | Module queue (PLAN §6 order) |
|---|---|---|---|
| **WS-A** Platform & Foundation | **Architect** (then integrator) | root config, `.github/`, `drizzle/`, `src/db/`, `src/shared/{contracts,lib,server}`, `src/shared/ui` core half, `src/features/auth`, `scripts/seed/index.ts`, `e2e/` | M01 → M02 → M03 → M04 → M05a → M06a → M06b → M09 (orchestrator) → M10 |
| **WS-B** Forms Engine + CFP | **B1** (builder) | `src/features/events`, `src/features/forms` (builder half), settings + forms routes | M11 → M12 → M13b → M14 |
| **WS-B** Forms Engine + CFP | **B2** (runtime) | `src/features/forms` (runtime half), `src/shared/lib/conditions.ts`, `app/(public)/submit/` | M13a (Fri night) → M15 skeleton + M16 pipeline (Sat) → M16 complete + M15 end-to-end (Sun) |
| **WS-C** Submissions Review | **WS-C** | `src/features/submissions`; Mon also `src/features/portal/{resources,admin}/**` (declared grant) | M17 + M18 `createSubmission` slice → M18 complete → M19 → M26 + M27 → M20 |
| **WS-D** Speaker Portal | **WS-D** | `src/features/portal`; Sat also `src/shared/server/r2.ts` + `src/shared/ui` rich half (declared grant) | M07 + M05b → M21 → M22 + M25 (manual/file) → M23 + M24 + M25 (form) → M41 |
| **WS-E** Agenda + Public/Embeds | **WS-E** | `src/features/agenda`, `src/features/embeds`, agenda/embeds routes, `app/(public)/e/`, `(embed)` | M29 → M28 → M32 → M30 + M33 → M31 |
| **WS-F** Comms + Dashboard + Airtable + API | **WS-F** | `src/features/{comms,dashboard,airtable}`, `workers/jobs/`, `api/v1`, `api/jobs` bodies, `/cal` | M08 → M34 (+ Sat checklist) → M35 + M36 → M38 + M40 start → M37 + M39 + M40 finish |

**The architect is the fan-out gate, not a feature owner.** After Saturday the architect stops feature work and switches to: arbitrating contract changes same-day, driving each checkpoint on the **deployed preview**, and owning merges to the hot files (schema index, root layout, `globals.css`, seed orchestrator).

**Cross-folder grants are temporary and explicit** (they exist so nobody blocks): WS-D owns `shared/ui` rich half + `shared/server/r2.ts` on Saturday; WS-C owns `features/portal/{resources,admin}/**` on Monday. Everything else stays disjoint.

---

## 2. Claiming a module — the Status protocol

Every work order in `modules/` opens with a status table. **That cell is the single source of truth for who is on what; `status.md` is the cross-module evidence summary.** The index in §5 below is static reference — do not maintain status there.

1. Pick the **top unclaimed module in your lane's queue whose hard deps are DONE** (dashed/stub deps do **not** block a start — see §4 of `execution.md`).
2. Edit that work order's Status cell: `NOT STARTED` → `IN PROGRESS`, and put your agent name in the Owner cell. Commit that one-line edit **first**, before you write any code. A status edit is never bundled into a feature PR.
3. Open the PR when the module's AC are green. Set Status → `IN REVIEW`.
4. Architect (or the designated reviewer) merges → Status → `DONE`. Only a merged-to-`main` module with its complete AC demonstrated counts as DONE for dependency purposes. If an AC names a deployed preview or an external service, that evidence is mandatory; fixture/localStorage behavior and localhost builds do not count.

```
NOT STARTED  ->  IN PROGRESS  ->  IN REVIEW  ->  DONE
```

If you must abandon a module mid-flight (swarm call, cut line fired), set it back to `NOT STARTED` with a one-line note in the work order's Notes section saying exactly what exists on which branch.

**One module at a time per agent.** Pick up the next only when the current one is `IN REVIEW` or `DONE`.

After the rev. 4 rebaseline, a status may carry one evidence label from `status.md` (`MERGED-PARTIAL`, `STACK-DEMO`, `SERVER-GAP`, `REVIEW-BLOCKED`, and — added in rev. 5 — `PR-OPEN`). The label explains partial progress; it never weakens the four-state protocol.

`PR-OPEN` marks a module whose implementation exists only on an unmerged branch. It pairs with `IN REVIEW` and is the label that keeps step 4's dependency rule honest: **a `PR-OPEN` module is not a satisfied hard dependency.** It does not soften step 1 — a solid edge into a `PR-OPEN` module still blocks the claim, exactly as `NOT STARTED` would. Only a *dashed* dependency lets you start against a stub or fixture, and that was already true. What you may do while you wait is pure preparatory work that claims nothing: contract-level tests, fixtures, and design notes. Never branch feature work off an open `agent/*` branch — it will be rebased or amended under you during review.

The rebaseline's 34 `IN PROGRESS` headers are a one-time audit of partial code already spread across the PR stack, not 34 active assignments. New work still obeys one active module per agent; the chosen recovery module should name its current owner/evidence while untouched partial modules retain their audit note.

---

## 3. Rules of engagement (PLAN.md §6 — binding)

- **Disjoint paths.** Your lane owns its feature folders and route files, per §1's table. Do not edit another lane's files. Temporary cross-folder ownership exists only where declared above.
- **Communicate through contracts, not through code.** Cross-feature communication happens *only* via `src/shared/contracts`, feature `index.ts` barrels, and the frozen DB schema. Cross-feature imports are barrel-or-`shared/*` ONLY (enforced by `eslint-plugin-boundaries`; violations are CI failures). Only `server/` files may import the db client.
- **Contracts and schema changes require architect-labeled PRs.** `src/shared/contracts` is **frozen after CP1 (Sat noon)**; `drizzle/` is big-bang then **additive-only**; `drizzle-kit push` is banned. If you need a change, open an architect-labeled PR and say so in the daily thread — the architect decides same-day.
- **Rebase onto `main` at least 2×/day.** Morning and after lunch, minimum. A lane that has not rebased since yesterday is the merge-hell risk in person.
- **PRs ≤ 600 lines.** Split larger work along the module's own sub-steps. A 1,200-line PR at 11 PM Monday is how a checkpoint gets missed.
- **Discord-watch rotation.** One designated agent per day monitors the hackathon Discord. Clarifications land in `DECISIONS.md` **same-day**. The organizer question queue starts with: conditional-logic UI, routing UI, drafts semantics (none appear in any screenshot).
- **Demo-or-it-didn't-happen.** Every day ends with an integration checkpoint on the **deployed preview**, not on localhost. "Works on my machine" is not a status.
- **Golden path first.** If the golden path is red, all NICE work stops and agents swarm it (see the standing swarm rule in `execution.md` §4).

---

## 4. Frozen decisions you must not re-litigate

These are PLAN.md's binding resolutions. Copy the signatures **character for character**; the CI invariant greps assume them.

**Single-owner write rules**
- Submissions (res. #8): exactly one file in the repo contains `INSERT INTO submissions` — M18's mutations file. It exports `createSubmission(eventId, CreateSubmissionInput)`, `updateSubmissionFromCfp(eventId, contactId, submissionId, CleanAnswers)`, `upsertDraft(eventId, contactId, formId, formVersion)`, `nextSubmissionCode(tx, eventId)`.
- Contacts (res. #13): `getOrCreateContact(tx, eventId, email)` and `updateContactFields(dbOrTx, eventId, contactId, partial)` — field-scoped, never whole-row; `updateContactFields` takes `DbOrTx` so single-statement saves (M22 profile, M27 email correction) run on `neon-http` without a ninth `withTx` path. They live in `src/features/portal/server/contacts.ts`, **owned by M21 (its Step 0, shipped Sat AM)** and imported from the `@/features/portal` barrel by all six writers. Direct `INSERT`/`UPDATE` on `contacts` anywhere else is a review blocker (the only other allowlisted path is `scripts/seed/contacts.ts`).
- Email rows: `enqueueEmail(tx, {eventId, templateKey, contactId, idempotencyKey, refs, secretPayloadCiphertext?})` — the only way to write `communication_logs`; the secret field is legal only for encrypted `portal_login` delivery. Default templates: `seedDefaultTemplates(dbOrTx, eventId)` (M34) is the only producer of `email_templates` rows (**8 keys** — the 7 domain templates plus `portal_login` for M06b's OTP/magic-link mail).
- Portal tokens (res. #12): `issuePortalToken(dbOrTx, {contactId, eventId, purpose, ttl, withOtp?}) → {tokenId, raw, otp?, expiresAt}` and the non-consuming `verifyPortalToken(raw, {purpose})`, both owned by auth. Ordinary links are minted at dispatch. The `portal_login` exception uses `withOtp:true` at request time and `tokenId` in its idempotency key, but its raw OTP/link crosses the outbox only as AES-GCM ciphertext that is cleared after dispatch; production log bodies redact it.
- Comms read-back: `listLog(eventId, filters): CommLogRow[]`.
- Renderer boundary: `FormFieldRendererProps` = `{snapshot, answers, onChange, mode: 'edit'|'review'|'readonly', sectionKeys?, participantId?, errors?}` — zero CFP-wizard imports. **There is no `'fill'` mode.**

**Pure/shared single implementations**
- `compileFormSnapshot` (M04) is the ONLY snapshot producer — builder saves and seed both call it.
- `conditions.ts` (M13a) is the ONE evaluator. Ops are exactly `eq | neq | in | not_in | answered | empty` (res. #10). Multi-select "contains option X" is expressed as `in` over option ids.
- `time.ts` 6-fn API (res. #9): `zonedInputToUtc`, `formatInZone` (always appends the zone label), `eventDayKey`, `endOfDayInTz`, `daysToEvent` (calendar-day diff in event tz, never `hours/24`), `addDuration`. `date-fns`/`date-fns-tz` import-restricted to this file.
- One `sanitize()` (two allowlists), one `<RichTextView>` — the only `dangerouslySetInnerHTML` site in the repo.

**Counting / lifecycle laws**
- Fan-out rule (res. #14): submission-targeted tasks assign to the **primary contact only, once per accepted submission**; contact-targeted tasks assign to members of `accepted_speakers_v` only. Baked into `task_assignments_v` SQL; consumed identically by M23/M25/M36/M38 — never re-derived.
- Auto-confirm (res. #15): `notifyDecisions` auto-sets `confirmation_status='confirmed'` on the primary contact of each accepted submission. There is no speaker-facing confirm CTA. M27 can override.
- Decision emails go to the **submitter (primary) contact only**; co-speakers learn via the portal.
- Idempotency-key recipes live in `contracts/` and are frozen at CP1. Compose them from natural keys — there is no `assignmentId`.
- Drafts never consume the per-user submission limit. One `status='draft'` row per `(form_id, submitter_contact_id)`.
- Submit payload always carries the client-rendered `form_version`; structural mismatch → typed `FORM_VERSION_STALE` carrying the fresh snapshot.

**CI invariant greps (PLAN §2 — your PR dies on these)**
- no `dangerouslySetInnerHTML` outside `RichTextView`
- no `process.env` outside `env.ts`
- no date libs **or local-tz `Date` methods** (`toLocaleString` family, `toDateString`/`toTimeString`, `getTimezoneOffset`, non-UTC `get*/set*` accessors, multi-arg `new Date(y, m, …)`) outside `time.ts` — scoped to `src/**` (rev. 3 delta #18)
- no Resend outside the dispatcher
- no `export const runtime = 'edge'` anywhere
- no `INSERT INTO submissions` / raw `contacts` writes outside their owning mutation files

**Drivers:** `neon-http` for all reads and single-statement writes. WebSocket `Pool` `withTx()` is confined to exactly **eight** audited runtime functions: `requestPortalLogin`, `createSubmission`, `upsertDraft`, `updateSubmissionFromCfp`, `notifyDecisions`, `completeTaskViaResponse`, `completeTaskViaUpload`, and `moveSession`. Adding a ninth deployed path is an architect decision; M09's one command-line seed transaction is the explicit non-runtime exception.

---

## 5. Module index (58 work orders)

Size: **S** ≈ 2h · **M** ≈ half-day · **L** ≈ day. Slots are from PLAN §6/§7 (see `execution.md` for the half-day wave table). **Slot day names are logical plan-days — Aug 8 2026 is a Saturday: plan-Fri = Sat 8/8, plan-Sat = Sun 8/9, plan-Sun = Mon 8/10, plan-Mon = Tue 8/11, plan-Tue = Wed 8/12 until 2 PM (CP4), plan-Wed = Wed 8/12 afternoon (PLAN §7, delta #21).** Hard deps are the solid edges of PLAN §5; *italic* deps are dashed — you start against a Phase-0 stub or fixture and swap in the real artifact when it lands.

| ID | Module | Work order | WS | Agent | Slot | Size | Hard deps (*dashed = start-anyway*) |
|---|---|---|---|---|---|---|---|
| M01 | Repo scaffold, CI, walking-skeleton deploy | [M01](modules/M01-scaffold-ci-deploy.md) | WS-A | Architect | Fri eve | L | — |
| M02 | Shared contracts | [M02](modules/M02-shared-contracts.md) | WS-A | Architect | Fri eve draft → Sat AM (FROZEN at CP1) | M | M01 |
| M03 | DB schema, migrations, views, transition trigger | [M03](modules/M03-db-schema-migrations.md) | WS-A | Architect | Fri eve draft → Sat AM | L | M02 |
| M04 | Shared server & pure libs (incl. snapshot compiler) | [M04](modules/M04-shared-libs.md) | WS-A | Architect | Fri eve (compiler slice) → Sat AM | M | M02 |
| M05a | Admin shell + core list primitives | [M05a](modules/M05a-admin-shell-ui.md) | WS-A | Architect | Sat AM | M | M01, M04 |
| M05b | Rich UI primitives (editor, picker, upload, tiles) | [M05b](modules/M05b-rich-ui-primitives.md) | WS-A | **WS-D** (first consumer) | Sat AM (prop stubs) → Sat PM | M | M04, M05a; *M07* |
| M06a | Admin auth | [M06a](modules/M06a-admin-auth.md) | WS-A | Architect | Sat AM | M | M03, M04 |
| M06b | Speaker/portal auth (OTP, magic link, tokens) | [M06b](modules/M06b-portal-auth.md) | WS-A | Architect | Sat PM | M–L | M06a, M03 |
| M07 | R2 storage (presign, finalize, `/f/[fileId]`) | [M07](modules/M07-r2-storage.md) | WS-D | WS-D | Fri eve (steps 1–3, mocked binding) → Sat AM | M | M03, M04 |
| M08 | Jobs worker + `/api/jobs/*` skeleton | [M08](modules/M08-jobs-worker.md) | WS-F | WS-F | Sat AM | S | M01 |
| M09 | Seed orchestrator + demo script | [M09](modules/M09-seed-demo-script.md) | WS-A | Architect (+ per-feature seed modules per lane) | Sat AM (orchestrator) → Sun (v2) → Tue (v3) | M | M03, M04 |
| M10 | Golden-path e2e, release engineering, OSS repo | [M10](modules/M10-e2e-release.md) | WS-A | Architect | **Sat PM skeleton (CP1 checklist item)** → Sun spec / CP2 load test → Tue 6 specs | M | M16, M18, M25, M30, M32, M34 |
| M11 | Events feature: CRUD, branding, vocab, settings hub | [M11](modules/M11-events-feature.md) | WS-B | B1 | Sat AM (server) → Sat PM (UI) | L | M03; *M05a, M06a, M07, M34* |
| M12 | Form builder core | [M12](modules/M12-form-builder-core.md) | WS-B | B1 | Sat PM (Step 1 slice) → Sun AM | L | M04, M05a, M05b, M11 |
| M13a | Condition evaluator (pure) | [M13a](modules/M13a-condition-evaluator.md) | WS-B | B2 | Fri eve | S–M | M02 |
| M13b | Rules UI (visibility + routing) | [M13b](modules/M13b-rules-ui.md) | WS-B | B1 | Sun PM | S–M | M12, M13a |
| M14 | Form settings + notifications steps | [M14](modules/M14-form-settings-notifications.md) | WS-B | B1 | Sun PM | M | M12 |
| M15 | Public CFP wizard UI | [M15](modules/M15-public-cfp-wizard.md) | WS-B | B2 | Sat PM (skeleton vs fixture) → Sun (e2e) → Mon (polish) | L | M13a, M06b, M07, M16; *M14* |
| M16 | Submit pipeline (server) | [M16](modules/M16-submit-pipeline.md) | WS-B | B2 | Sat PM (pipeline) → Sun AM (complete) | M | M13a, M03, M04; *M18* |
| M17 | Abstracts table + detail + manual create | [M17](modules/M17-abstracts-table.md) | WS-C | WS-C | Sat AM | L | M03, M05a; *M07* |
| M18 | Lifecycle transitions, submission mutations, notify | [M18](modules/M18-submission-mutations-notify.md) | WS-C | WS-C | Sat PM (`createSubmission` slice) → Sun AM (complete) | L | M02, M03, M04 |
| M19 | Evaluation plans + reviewer scoring | [M19](modules/M19-evaluation-scoring.md) | WS-C | WS-C | Sun PM → Mon AM | L | M03; *M17* |
| M20 | CSV export | [M20](modules/M20-csv-export.md) | WS-C | WS-C | Fri eve (`toCsv` + tests) → Tue | S | M17 |
| M21 | Portal shell, home, submissions view | [M21](modules/M21-portal-shell.md) | WS-D | WS-D | Sat PM → Sun AM | M | M05a, M06b; *M28* |
| M22 | Speaker profile | [M22](modules/M22-speaker-profile.md) | WS-D | WS-D | Sun PM | M | M21, M07, M05b |
| M23 | Tasks + file requests (admin) | [M23](modules/M23-tasks-admin.md) | WS-D | WS-D | Mon | M | M05a, M05b, M03 |
| M24 | Portal form builder (admin) | [M24](modules/M24-portal-form-builder.md) | WS-D | WS-D | Mon | M | M12 |
| M25 | Speaker task runtime + completions | [M25](modules/M25-task-runtime.md) | WS-D | WS-D | Sun PM (manual+file) → Mon (form mode) | L | M21, M07, M03; *M15, M23, M24, M16* |
| M26 | Resource / wiki pages | [M26](modules/M26-resource-pages.md) | WS-C | WS-C (declared grant) | Mon | S | M21, M04, M05b |
| M27 | Speakers admin + impersonation | [M27](modules/M27-speakers-admin.md) | WS-C | WS-C (declared grant) | Mon | M | M05a, M06b, M03; *M34* |
| M28 | Sessions CRUD, list view, tray, promotion | [M28](modules/M28-sessions-crud.md) | WS-E | WS-E | Sat AM → Sun AM | M | M03, M05a; *M11, M18* |
| M29 | Conflict engine (pure) | [M29](modules/M29-conflict-engine.md) | WS-E | WS-E | Original Fri eve → Sat AM; reconciliation + full suite still open | S | M02 |
| M30 | Day-grid drag & drop | [M30](modules/M30-day-grid-dnd.md) | WS-E | WS-E | Mon | L | M28, M29 |
| M31 | Week/Track/Room/Conflicts views | [M31](modules/M31-agenda-views.md) | WS-E | WS-E | Mon (Conflicts tab) → Tue AM (W/T/R) | M | M28, M29 |
| M32 | Public schedule + speaker gallery | [M32](modules/M32-public-schedule-gallery.md) | WS-E | WS-E | Sat PM (shell) → **Sun** (real queries; pulled forward) | L | M03, M28, M07 |
| M33 | Embed shells + snippet + admin | [M33](modules/M33-embed-shells.md) | WS-E | WS-E | Mon | M | M32 |
| M34 | Comms core: outbox dispatcher + template renderer | [M34](modules/M34-comms-outbox-dispatcher.md) | WS-F | WS-F | Sat AM start → Sat PM | L | M03, M04, M08; *M06b* |
| M35 | ICS + calendar invites | [M35](modules/M35-ics-calendar-invites.md) | WS-F | WS-F | Fri eve (pure builder) → Sun (canned check Sat) | M | M34, M02, M06b (`verifyPortalToken`, `/cal` routes) |
| M36 | Triggers + reminder/assignment scan | [M36](modules/M36-reminder-scan.md) | WS-F | WS-F | Sun | M | M34, M03 |
| M37 | Comms admin UI | [M37](modules/M37-comms-admin-ui.md) | WS-F | WS-F | Tue | M | M34, M05a |
| M38 | Dashboard (Speaker Tracking + Today) | [M38](modules/M38-dashboard.md) | WS-F | WS-F | Mon | L | M03, M05a |
| M39 | Airtable export | [M39](modules/M39-airtable-export.md) | WS-F | WS-F | Sat PM (base provisioning) → Tue | M | M03, M08 |
| M40 | Public API + keys | [M40](modules/M40-public-api.md) | WS-F | WS-F | Mon PM (start) → Tue | M | M32, M38, M04 |
| M41 | Speaker submission editing (edit-until-close) | [M41](modules/M41-speaker-edit-until-close.md) | WS-D | WS-D | Tue AM | M | M21, M15, M16, M18, M14 |
| M42 | Product auth: Better Auth + Google | [M42](modules/M42-product-auth.md) | Product/auth-chain lane | Architect-assigned | P4 (post-R3) | L | P2's deployed-auth proof |
| M43 | Organization tenancy | [M43](modules/M43-organization-tenancy.md) | Product/auth-chain lane | Architect-assigned | P4 (post-R3) | L | M42 |
| M44 | User management | [M44](modules/M44-user-management.md) | Product/auth-chain lane | Architect-assigned | P4 (post-R3) | L | M42, M43 |
| M45 | Self-serve onboarding | [M45](modules/M45-self-serve-onboarding.md) | Product/auth-chain lane | Architect-assigned | P4 (post-R3) | M | M43, M44 |
| M46 | Email compliance & deliverability ops | [M46](modules/M46-email-compliance-ops.md) | P3/P5 compliance lane | Architect-assigned | P4 (alongside P3) | M | P2 email proof |
| M47 | Data lifecycle & GDPR | [M47](modules/M47-data-lifecycle-gdpr.md) | Product/auth-chain lane | Architect-assigned | P4 (post-R3) | L | M43 |
| M48 | Observability & ops | [M48](modules/M48-observability-ops.md) | P3/P5 compliance lane | Architect-assigned | P4 (start anytime) | M | — |
| M49 | Billing | [M49](modules/M49-billing-scaffold.md) | Product/auth-chain lane | Architect-assigned | P4 (post-R3) | M | M43, M44 |
| M50 | Review operations depth + reviewer provisioning | [M50](modules/M50-review-operations.md) | WS-C / WS-A / WS-B / WS-F | Architect-assigned | Post-R3 | L | M06a, M12, M17, M19, M34, M37 |
| M51 | Standalone speaker roster operations | [M51](modules/M51-speaker-roster-operations.md) | WS-D / WS-F | Architect-assigned | Post-R3 | L | M06b, M07, M22, M27, M34, M37, M41 |
| M52 | Content and deliverables lifecycle | [M52](modules/M52-content-deliverables-lifecycle.md) | WS-D / WS-E / WS-F | Architect-assigned | Post-R3 | XL | M07, M22, M23, M25, M28, M34, M36 |
| M53 | Five public widgets + embed parity | [M53](modules/M53-public-widgets.md) | WS-E | WS-E | Post-R3 | XL | M32, M33, M35 |
| M54 | Assisted agenda placement | [M54](modules/M54-assisted-agenda-placement.md) | WS-E | WS-E | Post-M30/M51 | S | M04, M28, M29, M30, M51 |
| M55 | Organization-level Speaker CRM | [M55](modules/M55-speaker-crm.md) | Product lane | Architect-assigned | Optional after M43/M44 | XL | M43, M44, M51, M37/M46 |

The original recovery program contains 44 work orders. M50–M55 add six post-R3 product work orders.
M42–M49 (the P4 commercial layer) received their own retroactive work orders once they shipped —
[M42](modules/M42-product-auth.md) through [M49](modules/M49-billing-scaffold.md) — each documenting
what actually merged plus its remaining deployed-evidence acceptance criteria; see
[`product-roadmap.md`](product-roadmap.md)'s P4 table for the original scope sketch and
[`status.md`](status.md) §2f–§2g for the ledger.

---

## 6. Reference docs

**Execution overlay**

- [`analysis/next-steps.md`](analysis/next-steps.md) — ordered release-closure queue, dependencies, acceptance checks, and handoff order.

**Master plan**
- [`../PLAN.md`](../PLAN.md) — scope (§1), architecture (§2), data model (§3), module catalog (§4), dependency graph (§5), workstreams (§6), timeline (§7), risks (§8), cut lines (§9)
- [`product-roadmap.md`](product-roadmap.md) — the product overlay beyond the recovery bar: phased plan for wiring debt, external proof, trust/compliance, product-completeness work (M50–M54), and the optional commercial layer (M42–M49, M55). Subordinate to the recovery gates while they are open.

**Design (the how)**
- [`environments.md`](environments.md) — local/preview/production matrix, canonical resource names, bindings, secrets, and current scaffold drift
- [`design/data-model.md`](design/data-model.md) — full DDL (§3–§6 lands verbatim as `0000_init.sql` + `0001_views_triggers.sql`, plus PLAN §3's ★ deltas)
- [`design/app-architecture.md`](design/app-architecture.md) — repo layout, route map, feature boundaries, data flow
- [`design/platform-integrations.md`](design/platform-integrations.md) — OpenNext/Workers, R2, Resend, ICS, Airtable specifics
- [`design/quality-strategy.md`](design/quality-strategy.md) — bug-resistance rules R1–R12, test strategy, invariant greps

**Analysis (the what — extracted from the real product's screenshots: exact fields, columns, tabs, statuses)**
- [`analysis/event-config-cfp.md`](analysis/event-config-cfp.md) · [`analysis/form-builder.md`](analysis/form-builder.md) · [`analysis/abstracts-review.md`](analysis/abstracts-review.md) · [`analysis/speaker-portal.md`](analysis/speaker-portal.md) · [`analysis/agenda-embeds.md`](analysis/agenda-embeds.md) · [`analysis/dashboard-comms.md`](analysis/dashboard-comms.md)

**Living records (created during the build, not in this folder)**
- `DECISIONS.md` (repo root) — spike results, Discord clarifications, video diffs, Airtable base ids, ICS screenshots
- `docs/demo-script.md` — the judge's path; doubles as final QA
- `docs/spend/` — daily token/cost evidence for the $500 reimbursement proof

---

## 7. The bar

> A judge on the deployed Cloudflare URL, unassisted with `docs/demo-script.md`, can: create/brand an event → build a CFP form with one conditional field and one routing rule → submit from a phone **with a real OTP arriving at their own inbox**, deadline+limit enforced → see it pre-tagged in Abstracts **with every answer they typed visible in the drawer** → score it as the seeded reviewer → accept + Notify (exactly one email, logged, with portal link) → log into the portal, complete bio + headshot + slide-upload task → schedule the session (any input method) with a conflict detected and resolved → view the public schedule + speaker gallery **including their own just-confirmed speaker**, framed inside another site → watch the Speaker Tracking dashboard count drop when a task completes.

Everything above that line is margin. Nothing below it ships half-broken.
