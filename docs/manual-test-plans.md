# Openboard manual test plans

Seventeen manual test plans. They are weighted deliberately: **the core flow — solicit speakers,
accept or reject their talks, schedule the conference — gets five of them (MTP-03…MTP-07) and the
largest share of the document**, because that is the loop the product lives or dies on. Two more
(MTP-08, MTP-09) exist to hold a **design bar**: a screen that works but looks or feels wrong fails
these plans, and "it functions" is not a defence.

The four parts answer different questions. **Part I** — can a conference be run end to end?
**Part II** — is it finished? **Part III** — do the surfaces around the core flow hold up?
**Part IV** — do the operational surfaces the core flow *leans on* hold up, and do the boundaries
between tenants hold when somebody pushes at them?

Each plan is executable by one person in one sitting against a running instance. A step states an
action and an observable result; a mismatch is a defect, not a judgement call. The design plans are
the exception — they are deliberately judgement-heavy, and §0.7 gives the rubric that makes the
judgement repeatable.

Check each plan's **Known gaps** and §0.8 before filing a design defect — three closed
regressions have permanent checks there.

---

## 0. How to use this document

### 0.1 Environments

| Env | What it is | Use it for |
|---|---|---|
| **A — local, database-backed** | `pnpm dev` against a Postgres/Neon branch you own, seeded with `pnpm seed` | Default for every plan. Everything except real email delivery and R2 CORS |
| **C — deployed preview** | `https://sb-web-preview.yi-ding.workers.dev`, or your own deploy | Real email delivery, R2 presign/PUT under CORS, edge-cache headers, throttles behind a real IP |

There used to be an **Env B — browser demo** (`/` → **Open demo**; localStorage fixtures, no
credentials, no database), used for the design sweeps because it was fast and resettable. It was
deleted from the codebase on 2026-08-12: the environment no longer exists, and every plan that
named it now runs on Env A. `pnpm seed --wipe` replaces **Reset demo** — slower, but it resets the
only state the app has left.

### 0.2 Setup A — local, database-backed (do this once)

```bash
pnpm install
cp .dev.vars.example .dev.vars     # fill DATABASE_URL, DATABASE_URL_DIRECT, SESSION_SECRET

# The CLI steps below do NOT read .dev.vars — see the note underneath. Export it first:
set -a; source .dev.vars; set +a

pnpm db:migrate                    # applies drizzle/ to DATABASE_URL_DIRECT
APP_ENV=local pnpm seed --wipe     # deterministic demo world; --wipe TRUNCATEs first
pnpm dev                           # http://localhost:3000
```

> **Why the `source` line.** `.dev.vars` is a Wrangler file. `pnpm dev` reads it because
> `next.config.ts` calls `initOpenNextCloudflareForDev()`, which puts Wrangler's platform proxy
> behind `getEnv()` — but `pnpm db:migrate` (a tsx wrapper that writes a scratch Drizzle config
> and spawns `drizzle-kit migrate`) and `pnpm seed` / `pnpm admin:bootstrap` (tsx) run outside
> Next, where `getCloudflareContext()` throws and `getEnv()` falls back to bare `process.env`.
> In a clean shell they see nothing: `db:migrate` aborts with `DATABASE_URL_DIRECT is required
> to migrate the database` and the seed fails with `DATABASE_URL is required`. Export the file,
> or pass the two URLs inline on each command. (The same gap is in `docs/development.md`'s
> quickstart.)

Then the admin accounts (`docs/development.md` *Getting started* has the full flow), in the same exported shell:

```bash
BOOTSTRAP_EVENT_ID=9677e5d3-ccfc-5270-9b22-e551f8b4c57d \
BOOTSTRAP_ADMIN_PASSWORD=<12+ chars> \
BOOTSTRAP_REVIEWER_PASSWORD=<12+ chars> \
pnpm admin:bootstrap
```

Keep `.dev.vars` at its example defaults — `APP_ENV=local`, `EMAIL_MODE=log`, and
`EMAIL_FALLBACK_UI=1`. Those settings make speaker OTPs and outbound email inspectable without
Resend. Admin authentication always uses Better Auth; there is no provider switch or test-only
session endpoint.

**Fill `UNSUBSCRIBE_SECRET` and `SPEAKER_SHARE_SECRET` too.** Both are blank in the example file
and each needs 32+ characters; any random string does locally.

`UNSUBSCRIBE_SECRET` is not only the unsubscribe link. Every **non-essential** message — anything
outside the transactional set of accept, decline, schedule assigned/changed, portal sign-in and
the two admin-auth keys — carries a signed unsubscribe URL, and building that context fails with
an internal error when the secret is missing. Left blank, the submission receipt in MTP-03/04, the
reviewer invitations and reminders in MTP-05, the task mail in MTP-10, and most of MTP-12 all fail
in the dispatcher. `SPEAKER_SHARE_SECRET` signs the `/speaking/<token>` share page (MTP-07 §5,
MTP-10, MTP-11) the same way.

Neither failure is a defect — it is configuration — but both look exactly like a broken outbox, so
set them before you start rather than diagnosing them mid-plan.

**File uploads** presign against real R2. Either fill `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME=sb-files-dev`, or run those steps on Env C. CORS is only
genuinely exercised on a deployed origin.

**Set your workstation clock to a timezone that is not `America/Los_Angeles`** for the whole of
MTP-03…MTP-07. The seeded event is in Pacific; a tester in Pacific cannot detect a timezone bug.

### 0.3 Draining the outbox locally

Outbound email never sends inline: a domain event enqueues an outbox row, and the cron-driven
dispatcher is the only caller of Resend. Advance it by hand:

```bash
pnpm build:worker
pnpm exec wrangler dev -c workers/jobs/wrangler.jsonc -c wrangler.jsonc --test-scheduled
# In another terminal, trigger the private dispatcher:
curl 'http://localhost:8787/__scheduled?cron=*+*+*+*+*'
```

The web job implementations are reachable only through the local Service Binding; there is no
public job callback to invoke by hand.

One cron fires every minute and the dispatcher decides what is due from the tick's own UTC clock:
`outbox` every tick, `reminders` when the minute divides by 15, `cleanup` only at 09:00 UTC. The
`__scheduled` call above therefore runs whatever the wall clock says is due at the moment you run
it — at :15 it also scans and enqueues reminders, which is not always what you meant to do
mid-plan — and `cleanup` is out of reach unless you happen to be testing at 09:00.

Under `pnpm dev` — and only there — the private job routes answer a direct call, so you can drive
exactly one job and nothing else. The block that hides them lives in the deployed Worker's public
entrypoint (`custom-worker.ts`), not in the Next route:

```bash
curl -X POST -H 'x-openboard-private-job: JobsEntrypoint' \
  http://localhost:3000/worker-jobs/cleanup    # or outbox, or reminders
```

The response is that tick's stats. `cleanup` runs five independent sweeps — R2 orphans, the
retention sweep, the stalled-export nudge, expired-export pruning, and operational-error pruning —
and reports what each one did even when a sibling fails. On Env C the same path is a `404`
before OpenNext ever sees it; MTP-12 step 15 is the check that it stays that way.

With `EMAIL_MODE=log` the dispatcher writes the rendered message to the server log instead of calling
Resend — that log line is the artifact for local email assertions.

### 0.4 Fixed test data (deterministic — every seeded id is UUIDv5 over a frozen namespace)

| Thing | Value |
|---|---|
| Seeded event | **AI.Engineer Sandbox — NYC**, slug `ai-engineer-sandbox-event`, id `9677e5d3-ccfc-5270-9b22-e551f8b4c57d` |
| Empty-state event | **Empty Conf**, slug `empty-conf`, id `a4cae7eb-4079-5549-a52f-d9061c78b771` |
| Open CFP form | **Speak at AI.Engineer Sandbox**, id `f00d8460-e8d9-58de-ab01-f37d4ffe53df`, closes +38 days, limit 3 per email |
| Closed CFP form | **Lightning talks (closed)**, id `ffddbaf8-5540-5fd6-bea9-379096b21dde`, closed yesterday |
| Public CFP URL | `/submit/ai-engineer-sandbox-event/f00d8460-e8d9-58de-ab01-f37d4ffe53df` |
| Organizer (owner) | `organizer@openboard.dev` / `BOOTSTRAP_ADMIN_PASSWORD` |
| Reviewer / second reviewer | `reviewer@openboard.dev`, `reviewer2@openboard.dev` / `BOOTSTRAP_REVIEWER_PASSWORD` |
| Speakers (12) | `ada@openboard.events`, and `grace@`, `alan@`, `katherine@`, `margaret@`, `barbara@`, `tim@`, `radia@`, `linus@`, `sophie@`, `james@`, `shafi@` |
| Deliberately incomplete | `margaret`, `barbara` (no headshot); `tim`, `radia` (no bio); `james` (neither) — these drive the attention strip and `missing_assets_v` |
| Seeded review rounds | **Round 1** — open, 1–5, two weighted numeric criteria (Relevance ×2, Quality ×1), all three members assigned — `reviewer@` scoped to AI Agents and Platforms, the organizer and `reviewer2@` to everything — and partial scores. **Round 2 · Blind shortlist** — blind, windowed (opened yesterday, closes +14 days), typed criteria (numeric *Originality* ×2, select *Recommendation* ×1), and all four assignment states on one progress row: `reviewer@` is left entirely outstanding, `reviewer2@` supplies the completed rows, and one pair is recused |
| Tracks | AI Agents, Platforms, Security, Community |
| Rooms | Main Stage (800), Workshop A (120), Workshop B (120), Studio (60), Atrium (200) |
| Formats | Keynote 45, Talk 30, Workshop 90, Panel 45, Break 15 |
| Event timezone | `America/Los_Angeles`; seeded times are local wall-clock in that zone |

`pnpm seed` does **not** print the public CFP path — take it from this table, or from
**Copy live link** on the admin Forms list. (`docs/demo-script.md` used to claim the seed printed
it; corrected 2026-08-12.)

### 0.5 The submission status model (used heavily in MTP-06)

Seven statuses, and a transition table enforced in *both* the contract layer and a Postgres trigger.
The legal targets from each status:

| From | Legal targets |
|---|---|
| `draft` | `pending`, `withdrawn` |
| `pending` | `accept_queue`, `decline_queue`, `accepted`, `declined`, `withdrawn` |
| `accept_queue` | `pending`, `decline_queue`, `accepted`, `declined`, `withdrawn` |
| `decline_queue` | `pending`, `accept_queue`, `accepted`, `declined`, `withdrawn` |
| `accepted` | `pending`, `accept_queue`, `decline_queue`, `declined`, `withdrawn` |
| `declined` | `pending`, `accept_queue`, `decline_queue`, `accepted` — **not** `withdrawn` |
| `withdrawn` | `pending` only |

Everything not in a row is illegal, including every jump into `draft`. Speakers only ever see five
labels — Draft / Pending / Accepted / Declined / Withdrawn — because `accept_queue` and `decline_queue`
both display as **Pending** to them, and the raw enum string must never reach a user-facing screen
(that is a design defect under D6, not a cosmetic nit).

### 0.6 Roles and where each surface lives

- Organizer: `/events`, `/events/new`, `/events/<eventId>/{dashboard,forms,abstracts,evaluation,agenda,speakers,tasks,files,communications,resources,embeds,settings}`, plus `settings/api-keys` and `tasks/forms` one level down
- Reviewer: `/events/<eventId>/review` only — the nav hides everything else
- Speaker: `/portal/<eventSlug>/…`, including the public `login`, `verify` and `unsubscribe` pages inside that prefix
- Public: `/e/<eventSlug>/…`, `/embed/<eventSlug>/…`, `/submit/…`, `/speaking/<token>`, `/cal/<token>`, `/f/<fileId>`, `/api/v1/…`
- Organization: `/organizations`, `/organizations/<orgId>/{team,audit,billing,onboarding,crm}`, with `crm/segments`, `crm/pipeline` and `crm/<contactId>` under the CRM
- Account and sign-up: `/login`, `/login/{forgot,reset}`, `/signup`, `/signup/{check-email,confirm,verified}`, `/join`, `/account/sessions`

Only `/events/*`, `/portal/*`, `/organizations/*` and `/account/*` run the middleware. That is
what preserves the return path on a signed-out deep link, so a link into a CRM contact, a billing
page or your own sessions comes back to itself after sign-in rather than to the picker.

### 0.7 The design bar

**These ten checks apply to every screen any plan touches**, not only to MTP-08/09. When a plan step
says "record D-checks", walk this list against the screen you are on and log each miss with the
severity below. The bar is not "does it work" — a screen that works and reads as unfinished fails.

| # | Check | Fails when |
|---|---|---|
| **D1** | **Control provenance.** Every interactive control comes from `src/shared/ui/ui-kit.tsx` or is visually indistinguishable from one that does | The browser's own chrome shows through — an OS-drawn select arrow, an OS date popup, a default checkbox — next to designed controls |
| **D2** | **States.** Default, hover, focus, active, disabled, loading, error, and empty are all designed | A button that silently does nothing while in flight; a disabled control that looks enabled; a table that renders zero rows with no message |
| **D3** | **Keyboard and focus.** Visible focus ring on every focusable element, logical tab order, `Esc` closes overlays, focus returns to the trigger, no traps | Tabbing into a modal's background; a focus ring that disappears on a custom control; a drawer that dumps focus at `<body>` on close |
| **D4** | **Feedback.** Every mutation confirms within ~1 s or shows a busy state. Destructive actions confirm and name what is lost. Errors are specific and actionable | "Something went wrong"; a save with no acknowledgement; a delete with no confirmation, or one that does not say what disappears |
| **D5** | **Empty and first-run.** Every list, table, and panel has a deliberate empty state that names the next action | A blank rectangle, a header with nothing under it, "0 results" with no way forward |
| **D6** | **Content.** Consistent capitalization, no truncated or clipped labels, no raw identifiers or enum values on screen | `accept_queue` rendered verbatim; a bare UUID; "Sess-1" in one place and "SESS-001" in another |
| **D7** | **Layout.** 390 / 768 / 1280 / 1920 px with no horizontal page scroll, no overlap, no clipping. Wide tables scroll inside their own container. No layout shift after load | The page body scrolls sideways on a phone; a dialog taller than the viewport with no internal scroll; content jumping as data arrives |
| **D8** | **Theme and contrast.** Both themes render correctly; body text ≥ 4.5:1; no hardcoded color that ignores the token set | A panel that stays white in dark mode; muted text you cannot read; a status chip whose color is its only meaning |
| **D9** | **Time and number formatting.** One date format, one time convention, the timezone named wherever a time is entered or shown | A raw ISO string; a time with no zone on a screen where two zones are in play; `2/3` where the rest of the app says `Feb 3` |
| **D10** | **Flow economy.** A task is completable on the surface where the user starts it. If a prerequisite is missing, there is an inline way to create it | A picker with an empty state and no "add one" affordance, forcing a trip to another section and a restart |

**Severity:**

- **S1 — blocks.** The user cannot complete the task, or completes it wrongly without noticing.
- **S2 — likely error or abandonment.** Completable, but a reasonable user gets lost, backtracks, or
  has to be told how.
- **S3 — inconsistency or polish.** Correct and completable, but visibly not of a piece with the rest.

**Release bar: zero S1 and zero S2 anywhere on the core flow (MTP-03…MTP-07). S3 is tracked, not
blocking.** Outside the core flow, zero S1.

### 0.8 Closed design defects — the regression baseline

These three defects were fixed and their GitHub issues closed on 2026-08-12. Keep running the named
checks: any recurrence is a regression, not a known exception to the release bar.

---

**DD-1 — Native `<select>` everywhere. Resolved.**
([#115](https://github.com/yisding/symmetrical-happiness/issues/115))

`src/shared/ui/ui-kit.tsx` now exports `Select`. It keeps the native element's keyboard type-ahead,
Escape behavior, and touch picker while `.select-control` supplies the designed chevron and removes
OS chrome. Application call sites consume that primitive; a source scan should find no direct
`<select>` outside the primitive. Regress by comparing the admin and public dropdowns at 390 px and
by keyboard, not merely by counting tags.

---

**DD-2 — Two different date-entry idioms. Resolved.**
([#116](https://github.com/yisding/symmetrical-happiness/issues/116))

Admin scheduling, review windows, task deadlines, and speaker unavailability now use the shared
`DateTimePicker`, with the event timezone named at entry. `tests/unit/source-invariants.test.ts`
guards against new raw `date`/`datetime-local` controls on every surface. The public form renderer's
deliberate **Date** question uses `CalendarDatePicker`; it represents a calendar date rather than an
instant and therefore has no timezone conversion.

---

**DD-3 — No single-surface path to schedule an invited talk. Resolved.**
([#117](https://github.com/yisding/symmetrical-happiness/issues/117))

The Agenda session dialog now contains `SpeakerQuickAdd`; on a fresh event its empty state points to
that inline form, and the created speaker is selected without closing or restarting the session.
The Agenda toolbar also names and links to **Add abstract**, whose drawer can select or create a
speaker. Both paths use the shared collision-resistant `SESS-n` allocator, and manual creation sends no CFP receipt.
MTP-03 §2 and MTP-09 task 1 are the permanent regression scripts.

### 0.9 Recording a run

Record: environment, git SHA (`/api/health` returns the deployed `sha`), date, and per step
pass/fail. For a functional failure: URL, the request id from the error envelope, the browser
console, the server log line. For a design defect: screenshot, the D-check number, the severity, the
surface, and — if you can find it — the file. A failure that reproduces on Env A **and** Env C is an
application defect; Env C only is usually configuration.

---

# Part I — The core flow

MTP-03 through MTP-07 follow one conference from an empty CFP to a published schedule. **Run them in
order, in one sitting where you can** — each hands the next its data, and several defects only appear
across the seam. Appendix C compresses all five into a timed capstone rehearsal.

---

## MTP-03 — Solicit: authoring the CFP, publishing it, and the invited-speaker intake

**Environments:** A · **Duration:** ~85 min · **Precondition:** MTP-01, signed in as organizer, clock
set outside Pacific.

**Objective.** Prove an organizer can author a call for speakers that asks the right questions of the
right people, publish it, and — separately — get an invited speaker into the same pipeline without
the CFP.

### §1 Authoring

| # | Action | Expected result |
|---|---|---|
| 1 | Open **Forms** | Both seeded forms with status chips and submission counts. Record D5 for the count-zero case |
| 2 | Create a form | A draft opens in the six-step builder with default sections/fields |
| 3 | Add one field of each of the 8 types | Each has its own editor. Record D1/D2 on every type editor |
| 4 | Set required, help text, and a character limit on a text field | All three persist through a reload and appear on the public form |
| 5 | Exceed the character limit as a submitter later (MTP-04 §2) | Blocked client-side **and** server-side |
| 6 | Reorder fields by drag; reorder sections | Order persists; the public form matches. Keyboard reordering works or its absence is logged (D3) |
| 7 | Add a dropdown **Session length** with 30/60/90 | Options persist; the kit chevron, keyboard type-ahead, and touch picker match other dropdowns (DD-1 regression) |
| 8 | Add **Room preference**, visible only when Session length = 90 | The builder preview hides it until 90 is chosen |
| 9 | Nest a second condition (visible when Session length = 90 **and** Track = Platforms) | Both conditions are evaluated; neither alone reveals the field |
| 10 | Create a condition that references a field, then delete that field | The app refuses, or repairs the rule and says so. A silently broken rule is S1 |
| 10a | Delete a field in the middle of a section, then add a new one | The new question lands **last**, and stays there through a reload and in the public form. A new field that lands beside its deleted predecessor's neighbour, order deciding itself on each save, is the regression |
| 11 | Add a routing rule: Format = Workshop → track *AI Agents* + tag *Tooling* | Saves; appears in the rules list |
| 11a | Try to source a rule's condition from a **participant** question — *Company is not Acme → set Track Sponsored* | Refused on save, naming the condition: routing runs at submit time against the abstract answers alone, so a participant question is one it can never evaluate. Record a D10/D6 finding if the picker offers a source the save then rejects |
| 11b | Author an `is not` / `is empty` rule on an abstract question, then delete that question and submit a proposal | The rule stops matching, whether or not anybody has opened the routing panel since. The failure to avoid is the opposite: an unanswerable `neq`/`not_in`/`empty` rule matching **every** submission, taking first place in first-match-wins, and silently overriding the track the speaker chose |
| 12 | Add a second, conflicting rule and reorder the two | Precedence is explicit in the UI — the user can tell which wins without guessing (D6) |
| 13 | Duplicate a form **that has a conditional question** | A copy with its own id and no submissions; the original is untouched. Open the copy's rule: its source points at the *copy's* own field, and the public copy hides and reveals exactly as the original does. This is the escape hatch the product itself recommends once a form locks, so a failure here strands the organizer |
| 14 | Open the seeded CFP and try to delete the locked *Title* / *Email* fields | Refused, with a reason naming the mapping (`submission.title`, `contact.email`) |
| 15 | Edit a field label on the seeded form *that already has submissions* | Allowed, and a new snapshot version is created — existing submissions keep the version they were made against |
| 16 | Try a structural change on that same form (delete a field with answers) | Refused with a specific message, not a 500 |
| 17 | Open the builder in two tabs; save in A, then save a stale edit in B | B is refused as stale. It does not silently overwrite A (D4) |
| 18 | Set the close date, then reopen the picker | The date is shown in the **event's** timezone, and the zone is named (DD-2 regression, D9) |
| 19 | Publish; use **Copy live link** | `/submit/<eventSlug>/<uuid>`; a toast confirms the copy |
| 20 | Open the link in a private window | Your fields render in order with your headings and the event's branding |
| 21 | Replace the uuid with the event slug | 404 — not a crash, not someone else's form |

### §2 The invited speaker — the off-CFP intake

This section is the **DD-3** regression script. Run it from a fresh event so seeded contacts cannot
hide a missing inline-create path.

| # | Action | Expected result | Regression focus |
|---|---|---|---|
| 22 | You have a confirmed keynote from **Dr. Amara Osei (Kwame Labs)** who never saw the CFP. Starting on **Agenda**, get her talk onto the schedule | Completable from the Agenda, or the Agenda points you at the path that is | ≤2 surfaces, no restart |
| 23 | Open the Agenda's new-session dialog on an event with no contacts | An empty speaker picker that offers to create one inline | `SpeakerQuickAdd` stays in the dialog and selects the new contact |
| 24 | Find **Add abstract** without being told where it is | Discoverable from the Agenda or from a global "add" affordance | Agenda toolbar names the path |
| 25 | Use **Add abstract** to enter Amara's keynote | The form takes the speaker's name and email | Existing-speaker choice and inline create both work |
| 26 | Complete either intended path and place the talk | No abandoned form or prerequisite trip; record surfaces and restarts | 0 restarts |
| 27 | Confirm the manual abstract got a real `SESS-n` from the same allocator as CFP submissions | Codes are unique across both intake paths — no collision or duplicate; their numeric order is intentionally not meaningful |
| 28 | Confirm **no email** was sent by the manual creation | The outbox has no new row. An invited speaker must not receive a "thanks for submitting" |
| 29 | Import a roster CSV with 3 speakers, one duplicating Amara | A preview names creates/updates/rejects before committing; the duplicate merges rather than doubling |

### §3 Publication states

| # | Action | Expected result |
|---|---|---|
| 30 | Set the close date to 2 minutes out; wait for it to pass; reload the public link | The branded closed page. The transition needs no deploy or manual step |
| 31 | Reopen the form by extending the date | The public form accepts submissions again |
| 32 | Set the form to draft while it has submissions | Public link stops accepting; existing submissions are untouched and still visible in Abstracts |
| 33 | Open the seeded closed form's public URL | The branded closed page, with no route to the wizard |

### §4 Design checks for this plan

Walk §0.7 on: Forms list, each of the six builder steps, the field-type editors, the visibility-rule
editor, the routing-rules panel, the Add-abstract modal, and the public form. Specifically:

- **D1** on every dropdown in the builder (DD-1 regression: all use the shared `Select` chrome)
- **D5** on the Forms list with zero forms and on a form with zero fields
- **D6** on the field-type names — do they read the same in the picker, the list, and the public form?
- **D9** on every date the builder shows or accepts
- **D10** on the Add-abstract modal's speaker create/select path and the rule editors

### Exit criteria

All three sections pass. The invited-keynote path uses at most two surfaces and no form restart.
Zero S1/S2.

---

## MTP-04 — Intake: the public submission under real-world conditions

**Environments:** A, with §1 repeated on C · **Duration:** ~90 min · **Precondition:** MTP-03.

**Objective.** Prove a speaker can submit — on a phone, on a bad connection, in another timezone,
having walked away for a day — and that what lands in the database is exactly what they typed, once.

### §1 The happy path

| # | Action | Expected result |
|---|---|---|
| 1 | Open the public CFP in a private window | Step 1 of 4 (**Verify your email**), branded, with the deadline visible in a stated timezone |
| 2 | On step 1, enter `qa+01@openboard.events` | A code is requested. Env A shows the fallback box with the OTP and magic link; Env C sends a real email and shows no fallback box |
| 3 | Enter a wrong code | Rejected with a retry that does not clear the rest of the wizard |
| 4 | Enter the correct code | Signed in for submission; the wizard advances |
| 5 | Answer *Format* = **Workshop** | The conditional **Workshop duration** appears. Choosing **Talk** hides it again |
| 6 | **Submission A (the stripping case).** Answer the conditional, then change Format back to **Talk**, complete the required fields, and submit | Success page with a `SESS-n` code. The hidden branch's answer is **stripped**, not stored as an orphan |
| 7 | Check Submission A as organizer | Format **Talk**, and the track is the one the speaker chose — the Workshop routing rule matches `format = workshop` and must **not** have fired here |
| 8 | **Submission B (the routing case).** Start a second proposal. Set *Format* = **Workshop**, answer the Workshop duration follow-up, set *Track* = **Platforms**, complete Title, Description, First/Last, Email, and submit **with Workshop still selected** | Success page with a new `SESS-n` code |
| 9 | Check Submission B as organizer | Track reads **AI Agents**, tag **Tooling** — the routing rule overrode the speaker's *Platforms* answer |
| 10 | Open both submissions' answers | B has every answer including the conditional. A has no orphaned Workshop-duration answer — absent, not blank |
| 11 | *(Env C)* Repeat steps 1–8 with a real inbox | The OTP email arrives from the verified domain and the code works. There is no fixed-code shortcut in any environment; on Env A the same real code is surfaced in the login UI by `EMAIL_FALLBACK_UI=1` |

### §1a Co-speakers

The submitter is always the one primary speaker; the form's participant settings decide which
additional roles — co-speaker, moderator, panelist — the wizard offers, and the **Speaker** step is
where they are added. Run this section on a form with at least one secondary role enabled.

| # | Action | Expected result |
|---|---|---|
| 11a | On the Speaker step, add a co-speaker and fill in their details; submit | One submission with two participants. The organizer's drawer names both and marks which is primary |
| 11b | Put a participant question behind a condition whose source is *another participant question*, then fill the primary's answer and leave the co-speaker's blank | The co-speaker's section hides and reveals on exactly the same rule the server evaluates. The two failures to watch for are a required error naming a question that is not on screen, and an answer the speaker typed being discarded as hidden — both mean client and server disagreed about which questions exist for that person |
| 11c | Put the same question behind a condition sourced from an **abstract** question | Both sides agree again: a participant's visibility is decided by the abstract answers plus that participant's own, never by another participant's |
| 11d | As the co-speaker, sign in to the portal and open the proposal | Readable, with no **Edit** route: reaching the edit URL by hand is refused as not-found, not merely hidden. Editing belongs to the submitter alone, and deliberately so — there is no lock between two browsers, so allowing both would lose one of their edits with nothing to show for it |
| 11e | Accept the submission and notify (MTP-06 §3), then check both contacts | Both are `confirmed`, and both appear on the published session. A co-speaker left unconfirmed is joined out of `published_speakers_v` and the session publishes without them |

### §2 Validation and content

| # | Action | Expected result |
|---|---|---|
| 12 | Submit with every required field empty | Each error is on its own field, the first invalid field takes focus, and the page does not scroll to the top (D3/D4) |
| 13 | Enter a malformed email at the account step | Rejected as user input. **Not** an internal error — a bad server config once wore user-validation's clothes here |
| 14 | Exceed a text field's character limit | Blocked with a live counter; the server rejects it too if you bypass the client |
| 15 | Paste 5,000 words of rich text into Description | Accepted up to the limit, formatting preserved, no layout break in the drawer or the portal (D7) |
| 16 | Submit a title of `<img src=x onerror=alert(1)>` | Stored and rendered inert everywhere — Abstracts, drawer, portal, exports. No dialog |
| 17 | Submit emoji, accented characters, CJK, and an RTL string | Round-trip intact in every surface, including the CSV export |
| 18 | Submit a title of exactly 255 characters, then 256 | 255 accepted, 256 rejected with the limit named |

### §3 Interruption, resumption, and duplication

| # | Action | Expected result |
|---|---|---|
| 19 | Mid-wizard, reload the page | Answers survive — the draft is server-persisted |
| 20 | Mid-wizard, close the browser; return **on a different device** with the same email and a new code | The draft is there. This is the difference between a server draft and `sessionStorage` |
| 21 | Open the same draft in two tabs; edit a field in each; submit from tab A, then tab B | One submission, or a clear conflict message. Never two rows for one draft |
| 22 | Double-click **Submit** | One submission, one code |
| 23 | Submit with the network throttled to offline, then restore | A clear failure and a retry that does not duplicate. The user must be able to tell whether it went through (D4) |
| 23a | Do the same on the **code request** at step 1 | The copy says the send could not be confirmed and leaves the code box usable — a request that may well have been delivered must not be reported as a flat failure that hides the code the speaker is holding. A transport failure is the one case where "we don't know" is the honest answer, and every screen that writes must be able to say it |
| 24 | Press Back after the success page | You cannot resubmit the same draft by going back |
| 25 | Submit 3 proposals from one email (the seeded limit), then a 4th | The 4th is blocked by a friendly limit page naming the limit — not a 500, not a silent failure |

### §4 The deadline boundary

| # | Action | Expected result |
|---|---|---|
| 26 | Set the form to close 3 minutes out. Start a submission at minute 1, submit at minute 4 | The server refuses on the deadline. It does not accept because the wizard opened before close, and it says so kindly |
| 27 | Confirm the boundary is evaluated in the **event's** timezone, not the browser's | With your clock outside Pacific, the cutoff still fires at the event's local 23:59 |
| 28 | Reopen the form; resubmit | Accepted, with the draft intact |

### §5 Edit-until-close and withdrawal

| # | Action | Expected result |
|---|---|---|
| 29 | As the speaker, portal → Submissions → the new proposal → **Edit your proposal** | The CTA is present while the form is open and the submission undecided |
| 30 | Change an answer; save | Persists; the organizer sees the new value; the submission keeps its code and its `pending` status |
| 31 | Accept the submission as organizer; reload the portal | The **Edit** CTA is gone. Decided work is not editable |
| 32 | Close the form; check an undecided submission's CTA | Also gone, with an explanation rather than a dead button (D2/D4) |
| 33 | Withdraw a submission from the portal | Status `withdrawn`; it leaves the organizer's pending tab; the count drops |

### §6 Integrity cross-check

| # | Action | Expected result |
|---|---|---|
| 34 | Count submissions in Abstracts, on the Dashboard, and via `/api/v1/events/<slug>/stats` | All three agree |
| 35 | List every `SESS-n` code issued in this plan | Unique and never reused — including the manual abstract from MTP-03 §2; gaps and non-sequential order are expected |
| 36 | Export CSV and diff a row against the drawer | Every answer matches; commas and newlines are correctly quoted |

### §7 Design checks

Walk §0.7 on all four wizard steps (three when participant collection is off) at 390 px, the success page, the limit page, the closed page, and
the portal submission view. Specifically: **D2** on the submit button in flight; **D3** on the OTP
input (numeric keypad, autocomplete `one-time-code`, paste of a 6-digit code); **D7** at 390 px on
every step; **D9** on the deadline copy.

### Exit criteria

§1–§6 pass. Steps 21, 22, 23 (no duplicate submissions) and step 27 (timezone boundary) are
non-negotiable, as is step 7 — a routing rule that fires when its condition is *not* met is as wrong
as one that fails to fire.

---

## MTP-05 — Evaluate: review rounds, assignment, and scoring

**Environments:** A · **Duration:** ~70 min · **Precondition:** MTP-04, so real submissions exist.
Two browser profiles: organizer and `reviewer@openboard.dev`.

**Objective.** Prove an organizer can govern a round, a reviewer works exactly their own queue, and
the number the organizer decides on is the number the criteria define.

### §1 Round setup

| # | Action | Expected result |
|---|---|---|
| 1 | Open **Evaluation** | Two seeded rounds — Round 1 (open, untyped, partially scored) and **Round 2 · Blind shortlist** (windowed, blind) — each with criteria, weights, scale, and assignment counts |
| 2 | Create a round with two weighted criteria on a 1–5 scale | Saves as Round 3; all three rounds are independently editable — except Round 1's scale/criteria/weights, which are locked because it already has reviews |
| 3 | Set a zero or negative weight | Rejected with the rule stated, before save. Weights are arbitrary positive numbers used in a weighted mean — there is no required total |
| 4 | Set the round's open/close window | Shared picker names and applies the event timezone; verify from a workstation in another zone (DD-2 regression, D9) |
| 5 | Close the round's window and open a reviewer's queue | Scoring is refused with an explanation, not a silent no-op |

### §2 Assignment and recusal

| # | Action | Expected result |
|---|---|---|
| 6 | Assign `reviewer2@openboard.dev` to 3 named submissions | Counts update; the reviewer's queue length matches exactly |
| 7 | Assign a reviewer by **track** | Every submission on that track is assigned, and only those |
| 8 | Record a **recusal** for one reviewer/submission pair | It leaves that queue and is visibly recorded as a recusal — not as a deleted assignment |
| 9 | Try to assign the same reviewer twice to one submission | Idempotent — no duplicate assignment row |
| 10 | Provision a brand-new reviewer by email | They are invited, and on first sign-in land in their queue with the right scope |

### §3 Blind review and scoping

| # | Action | Expected result |
|---|---|---|
| 11 | Turn on blind review | Reviewer-facing views stop showing speaker identity |
| 12 | As the reviewer, open a queued submission | No name, company, email, or bio anywhere — including inside the answers block and any attachment filename |
| 13 | As the reviewer, hand-type a submission id not assigned to you | Denied |
| 14 | As the reviewer, hand-type `/events/<eventId>/abstracts` | Denied — the reviewer has one surface |
| 15 | As the reviewer, hand-type the other event's review URL | Denied |

### §4 Scoring and arithmetic

| # | Action | Expected result |
|---|---|---|
| 16 | Score three submissions on both criteria; save each | Each save confirms; the queue marks them done and advances (D4) |
| 17 | Re-open a scored submission and change one score | The current score is replaced — no duplicate review row and no double-count — while the organizer's proposal drawer retains both attributed revisions with their event-local timestamps |
| 17a | Save that unchanged score again | The review history does not add a duplicate revision; prior criterion labels and select-option names remain exactly as they were when each revision was saved |
| 18 | Leave one criterion blank and save | Either a clear "incomplete" state or a specific error. Never a silent zero |
| 19 | Hand-compute the weighted average for one submission and compare to the organizer's **Rating** | Exact match. A mismatch here is S1 — it means decisions are made on a wrong number |
| 20 | Have a second reviewer score the same submission differently | The aggregate reflects both, per the round's documented rule, and the reviewer count is visible |
| 21 | Sort Abstracts by Rating | The order matches the ratings; unscored rows sort predictably rather than as zero |
| 22 | Edit the form after a submission was scored, then re-open the queue item | The reviewer still sees the **pinned snapshot**, not the edited form |
| 22a | With **Share committee averages** off, score the same proposal as two reviewers; then enable it and reload | Before opt-in, neither reviewer payload nor UI reveals the live mean or reviewer count. After opt-in, both show the committee average clearly |
| 22b | With the round still hiding averages, open a queued proposal as the reviewer and read the **network response**, not the screen | No rating and no reviewer count anywhere in the JSON. A UI that hides a number the payload carries is not blind review; check the response body, because that is the half that has been wrong before |
| 22c | With averages shared, score a proposal in **Round 2** that also carries Round 1 scores | The mean the reviewer sees is Round 2's — their own round's — not the event's active plan's. A number no reviewer in this round ever gave is worse than no number |
| 22d | Delete a criterion, add a different one in its place, and save | Existing scores stay with the criteria that produced them. A new criterion inheriting a deleted one's identity resurfaces old answers under a new label, and is S1 |
| 22e | Withdraw a submission that is assigned and unscored, then look at the reviewer's nav badge, the round's progress row, and the reminder preflight | All three drop it, the same way the queue already does. A count a reviewer cannot clear — because opening the queue renders nothing — sends reminders nobody can act on |

### §5 Reminders

| # | Action | Expected result |
|---|---|---|
| 23 | Send reviewer reminders for incomplete assignments | The action reports how many were enqueued |
| 24 | Drain the outbox | One reminder per incomplete reviewer, including existing event members who were not already speaker contacts |

### §6 Design checks

Walk §0.7 on the plans list, the plan editor, the assignment drawer, and the reviewer queue.
Specifically: **D1** on the plan editor's shared selects; **D2** on the scoring control (does a
saved score look different from an unsaved one?); **D5** on an empty queue — a reviewer with nothing
to do should be told that clearly; **D9** on the round window (DD-2 regression).

### Exit criteria

Steps 12, 19, 22 are the load-bearing three: blindness, arithmetic, snapshot pinning. Add 22b —
what a round withholds has to be withheld in the response, not merely left off the screen.

---

## MTP-06 — Decide: accept, reject, and tell the speakers

**Environments:** A, with §4 repeated on C · **Duration:** ~85 min · **Precondition:** MTP-05.

**Objective.** Prove the decision machinery is correct in every direction — including undo — and that
each decision produces exactly one message to exactly the right person, once.

### §1 The transition matrix

Work the table in §0.5. For each **from** status, attempt a move to all seven targets, through the
UI where the UI offers it and through `POST /api/internal/submissions/<eventId>/transition`
otherwise. This is 49 attempts; a spreadsheet with a row per pair is the right artifact.

| # | Action | Expected result |
|---|---|---|
| 1 | Every legal pair in §0.5 | Succeeds, and the new status is reflected in the tabs, the drawer, the dashboard, and the portal |
| 2 | Every illegal pair | Refused with a specific error naming the transition — not a 500, and not a silent no-op that leaves the row unchanged while the UI claims success |
| 3 | `declined → withdrawn` specifically | Refused. It is the one absence that looks like an oversight and is not |
| 4 | `withdrawn → pending` | Allowed — a speaker who withdrew can be reinstated |
| 5 | Any transition into `draft` | Refused from every status |

**The trigger needs its own test, and the API cannot give it one.** `transitionStatus`
(in `src/features/submissions/server/mutations.ts`) calls `assertTransition` for every source status
*before* it issues the `UPDATE`, so an illegal pair posted to the API is rejected in the application
layer and never reaches Postgres. Steps 1–5 therefore prove the application guard only — they would
pass unchanged if `guard_submission_transition()` were dropped tomorrow.

To test the second line of defence, bypass the application with a direct statement against the
database (`drizzle/0001_views_triggers.sql:1-27` is what you are exercising):

```sql
BEGIN;
-- pick any row and attempt an illegal move; declined → withdrawn is the sharpest case
UPDATE submissions SET status = 'withdrawn'
 WHERE id = '<a declined submission id>' AND status = 'declined';
ROLLBACK;   -- the trigger should have raised before you get here
```

| # | Action | Expected result |
|---|---|---|
| 6 | Run the statement above for **three** illegal pairs, including `declined → withdrawn` and one jump into `draft` | Each raises from `guard_submission_transition()` and aborts the transaction. A successful `UPDATE` here means the trigger is missing or wrong, however green the API looks |
| 7 | Run one **legal** pair the same way | Succeeds — proving the failures in step 6 are the guard and not a broken statement |

### §2 Queues and bulk decisions

| # | Action | Expected result |
|---|---|---|
| 8 | Select 5 pending submissions → **Move to accept queue** | All 5 staged. Nothing is emailed by staging (D4 — the UI must make clear that staging is not deciding) |
| 9 | Move 2 of them from accept queue to decline queue | Allowed; counts on both tabs update |
| 10 | Press **Notify** and confirm **Queue decision emails** | The accept queue commits to `accepted` and the decline queue commits to `declined` in the same action |
| 11 | Select 20 rows across two pages and bulk-decide | The action applies to your actual selection — confirm the count in the confirmation matches, and spot-check a row from each page |
| 12 | Bulk-decide with one row already in the target status | Idempotent; no error, no double-write |
| 13 | Undo a decision, then re-decide it; open the proposal drawer | Both moves are legal, and **Decision history** retains every prior state with the organizer and event-local timestamp |
| 13a | Withdraw a pending proposal as its speaker, then inspect it as organizer | The timeline attributes the withdrawal to that speaker; deleting the speaker later removes their personal reference without deleting the status history |
| 14 | Attempt a bulk action on a withdrawn row | Skipped with a reason, not a hard failure that abandons the whole batch |

### §3 Notification

| # | Action | Expected result |
|---|---|---|
| 15 | **Notify {n}** | The confirm dialog names the exact decision count before sending, and finalizes both queues |
| 16 | Drain the outbox | **Exactly one** `submission_accepted` row per accepted submission. Recipients are the submitters only |
| 17 | Read a rendered message | Correct speaker name, correct talk title, a working portal link, no template tokens, no raw ids (D6) |
| 18 | Press **Notify** again with nothing changed | No new rows, and the UI says why |
| 19 | Accept one more submission, then Notify | Exactly one new message — for the new one only |
| 20 | Notify **declined** speakers | One decline message each; the copy is a decline, and no accept message is sent to anyone |
| 21 | Add a suppression for one recipient, then Notify | That address is skipped and the skip is recorded with its reason — not counted as sent |
| 22 | Undo an acceptance **after** notifying, then re-accept and notify | The speaker is not silently told twice with no explanation. Whatever the product does here, it must be deliberate and visible |
| 23 | As the notified speaker, open the portal | Status reads **Accepted**; the decision is visible without an email |
| 24 | Check a `decline_queue` submission in the portal | It reads **Pending** — internal queue names never leak (D6, and a privacy matter) |

### §3a Acceptance and confirmation

Acceptance is what confirms a speaker: there is no speaker-facing confirm button, and
`published_speakers_v` requires `confirmation_status = 'confirmed'`, so an unconfirmed person is
joined out of the public schedule even when their session is published.

| # | Action | Expected result |
|---|---|---|
| 24a | Accept a submission that has a co-speaker, through **Notify** | **Every** participant is confirmed, not only the primary. A session that publishes with one of its two speakers missing is the failure |
| 24b | Accept a submission by moving it straight to `accepted` from the drawer, and one created already accepted from **Add abstract** | Its participants are confirmed too. Confirmation follows the acceptance, not the mail that announces it — a direct move sends no decision email and used to confirm nobody, so its session published with an empty speaker list |
| 24c | Set one participant to **declined** by hand, then accept the submission again | They stay declined. An organizer who said someone is not coming must not be overruled by a re-acceptance — only `unconfirmed` is promoted |
| 24d | Notify an acceptance for a submission with no participants at all, only a submitter | The submitter is confirmed as the fallback. Where participants exist, the submitter is *not* confirmed for being the submitter — the person who filled the form in on somebody else's behalf is not the speaker |

### §4 Delivery on Env C

| # | Action | Expected result |
|---|---|---|
| 25 | With `EMAIL_MODE=send` and an allowlisted inbox, accept and notify | Delivered from the verified domain, `dmarc=pass`, SPF/DKIM aligned |
| 26 | Inspect headers | `List-Unsubscribe` present; reply-to is a monitored address |
| 27 | Press Notify twice on Env C | One delivery. Idempotency holds across the real dispatcher |

### §5 Integrity cross-check

| # | Action | Expected result |
|---|---|---|
| 28 | Compare each status tab's count to the counts endpoint and the dashboard | All agree. A doubled count means a per-plan ratings join leaked into a count |
| 29 | Compare accepted count to `/api/v1/events/<slug>/stats` | Agrees |
| 30 | Confirm no declined or withdrawn submission appears on any public surface | Absent from all five public pages and both APIs |

### §6 Design checks

Walk §0.7 on the Abstracts table, the filter/tab bar, the detail drawer, the bulk-action bar, and the
notify confirmation. Specifically: **D2** on the bulk bar (does it show what is selected, and does it
survive pagination?); **D4** on notify — an irreversible mass email needs an unambiguous confirmation
naming the count; **D6** on status labels everywhere; **D7** on the table at 1280 px with all columns.

### Exit criteria

§1 complete — all 49 pairs recorded through the application **and** steps 6–7's direct-SQL proof that
the trigger independently refuses. Then step 16 (exactly one email each), step 18 (idempotent
re-notify), step 24 (no internal status leaks), and §5 (counts agree).

---

## MTP-07 — Schedule: promotion, placement, conflicts, and publication

**Environments:** A, with §6 on C · **Duration:** ~105 min · **Precondition:** MTP-06, so accepted
talks exist. Clock still outside Pacific.

**Objective.** Prove accepted talks become sessions, that placement is safe and reversible, that
conflicts are detected in all three dimensions, and that publishing is the single act that makes a
session public.

### §1 From acceptance to a session

| # | Action | Expected result |
|---|---|---|
| 1 | Promote an accepted submission to a session | A linked draft session carrying the title and speaker |
| 2 | Promote the same submission again (double-click, or two tabs) | The **same** session id comes back — one session, not two |
| 3 | Try to promote a `pending` submission | Refused |
| 4 | Change the submission's title after promotion | The relationship is clear: either the session follows, or the divergence is visible. A silent drift is S2 |
| 5 | Withdraw a submission that has a scheduled session | The organizer is warned that a scheduled session is affected — not left to find out publicly |
| 6 | Find every accepted submission with no session | There is a way to see this list. If there is not, that is a D10 finding |

### §2 Placement

| # | Action | Expected result |
|---|---|---|
| 7 | Create a session via the dialog: title, format, track, room, start, duration | Lands in the grid at the right slot; the format's default duration prefills |
| 8 | Note the timezone handling of the start time | The dialog names the event zone. With your clock elsewhere, the session lands where the event's local time says (D9) |
| 9 | Drag a session to a new slot | It lands where dropped and survives a reload |
| 10 | Drag a session to an invalid target (outside a day, onto a break) | Rejected visibly, and the session returns to its origin — no silent snap to a wrong slot |
| 11 | Resize / change duration so a session crosses midnight or the day boundary | Handled deliberately — either prevented with a reason or represented correctly on both days |
| 11a | On a day carrying a **DST transition** in the event's zone (move the event's dates onto one, or make a throwaway event that lands on it), drag a session across the transition, then drag one that spans it | The session keeps the length it is *drawn* with — a 60-minute talk stays 60 minutes wherever it is dropped. A session that grows or shrinks by exactly an hour means its span was measured as elapsed UTC instead of on the clock, and every speaker is then sent a `schedule_changed` invite carrying the wrong end time. Resize the same sessions too: both edges must agree |
| 12 | Place a session in a room whose capacity is below the session's expected capacity | Record what happens. If nothing warns, that is a D-finding to file, not a pass |
| 13 | Edit the same session in two tabs, saving both | The second save fails visibly on the concurrency check |
| 14 | Open a session's **revisions** | Prior placements are recorded with who and when |
| 15 | Undo a placement | The prior slot is restored |

### §3 Conflicts

| # | Action | Expected result |
|---|---|---|
| 16 | Two sessions overlapping in the **same room** | Exactly **one** conflict raised — not one per session |
| 17 | Same time, different rooms, **same speaker** | A speaker conflict, naming the speaker |
| 18 | Same time, different rooms, **same track** | A track conflict |
| 19 | Back-to-back (one ends exactly as the next starts) | **No** conflict — adjacency is not overlap |
| 20 | One session fully containing another in the same room | A conflict — containment counts as overlap |
| 21 | The two seeded conflict pairs (**⚠ Demo conflict A** — same room; **⚠ Demo conflict B** — same speaker) and the seeded back-to-back pair | A and B flag (the event total is exactly two); the back-to-back pair does not |
| 22 | Resolve a conflict by moving one session | The indicator clears immediately, without a reload |
| 23 | Create three mutually overlapping sessions in one room | The count and presentation are sane — not a combinatorial wall of duplicates (D6/D7) |
| 24 | Assign a speaker to two sessions in the same slot, then remove them from one | The speaker conflict clears |

### §4 Assisted placement

| # | Action | Expected result |
|---|---|---|
| 25 | Run **Auto-place** on the unscheduled set | A deterministic preview: same input, same order, same proposals every run |
| 26 | Mark a speaker unavailable, re-run | That row carries a **useful reason** naming the unavailability — not a generic failure (D4) |
| 27 | Accept one proposed row; reject another | Only the accepted one is applied; the rejected one stays unscheduled |
| 28 | Reload | The applied placement persisted through the audited move path |
| 29 | Run Auto-place when nothing can be placed | A clear "nothing to place / nothing fits" state, with the reason (D5) |

### §5 Publication

| # | Action | Expected result |
|---|---|---|
| 30 | Publish one session; open `/e/ai-engineer-sandbox-event/agenda` | It appears publicly |
| 30a | In the session dialog, choose **Leave unscheduled (keep in the tray)** together with the **Published** status, and save. Repeat on a new session and on an existing draft | Refused both times, on the field, with the way out named — schedule it, or save it as a draft. A published session with no time is on no public surface and notifies nobody, while the List view badges it *Published*: indistinguishable from a draft in the one place it shows up |
| 30b | Unschedule a session that is **already** published — drag it back to the tray | Allowed. This is a different act from publishing something that never had a time, and it is how a talk gets pulled: every speaker's calendar item is cancelled |
| 31 | Leave another unpublished; search for it publicly and in `/api/v1/events/<slug>/schedule` | Absent from both |
| 32 | Bulk-publish the rest | All appear on the next load; the action reports how many |
| 33 | Unpublish a published session | It disappears publicly. Any speaker-facing consequence is visible to the organizer first |
| 34 | Move a **published** session | The public schedule reflects the move, and a **Schedule changed** message is enqueued — not a duplicate invite |
| 35 | Delete a published session | Gone publicly; calendar consumers see a cancellation, not a silent gap |
| 35a | Drain the outbox and open the CANCEL that step 35 produced | It describes the event the recipient actually received — the original title, time and room — even though the session row it came from no longer exists. A cancellation assembled from what is left on a deleted or reassigned session cancels the wrong thing, or nothing |
| 35b | Force the cancellation to be retried (fail it once, let the dispatcher pick it up again) | The retry is the same message: same UID, same details. A cancellation that redraws itself from current state on each attempt is not a cancellation |
| 36 | Check the public page's day tabs with your clock outside Pacific | Sessions bin onto the correct **event-local** day. A session at 9 pm Pacific must not appear on the next day |
| 37 | Publish the whole schedule and compare against Abstracts | Every accepted talk is either scheduled or knowingly unscheduled; nothing accepted has silently vanished |
| 37a | With nothing published, look for **Ready to announce** on the Agenda toolbar | Absent. Handing an organizer a bundle of links before anything is public is handing them broken links |
| 37b | Publish the schedule, then open **Ready to announce** | Suggested post copy, the five public URLs, an agenda embed snippet, and one "I'm speaking!" share link per accepted speaker — every row copy-to-clipboard, nothing here mutates anything |
| 37c | Open one of those share links signed out, in a private window | The speaker's page renders. A speaker with no name reads **Unnamed speaker** — never their email address, in the heading, the tab title, or the link preview a chat client scrapes (MTP-11 step 9a) |

### §6 On the deployed preview

| # | Action | Expected result |
|---|---|---|
| 38 | Repeat steps 9, 16–19, 25–28 on Env C | Same behavior. Drag-and-drop in particular has no deployed pass on record |
| 39 | After publishing, request the public schedule until regeneration settles | A fresh response has `s-maxage`, or a cached response reports `x-nextjs-cache: HIT`; `STALE` alone is not a pass, its `data-openboard-deployment` marker matches `/api/health`, and the newly published session is in the payload |

### §7 Design checks

Walk §0.7 on the agenda grid, the session dialog, the conflict indicator, the auto-place preview,
the **Ready to announce** modal, and every view (list/day/week/track/room). Specifically:

- **D1** on the session dialog's shared selects (DD-1 regression) and **D9** on its zoned placement inputs (DD-2 regression)
- **D3** on drag-and-drop — **is there a keyboard path to move a session?** If not, that is S1 for
  accessibility, and it is the kind of thing a mouse-only tester never notices
- **D7** on the grid at 390 px and at 1920 px with 5 rooms and a full day
- **D8** on the conflict indicator — if color is its only signal, it fails
- **D10** on the new-session dialog's inline speaker-create path (DD-3 regression)

### Exit criteria

§1 (idempotent promotion), §3 in full (every conflict dimension plus adjacency), §5 steps 30a, 30b, 31
and 36 (nothing publishes without a time; unscheduling one is reversible and cancels; nothing
unpublished leaks; timezone binning). Zero new
S1/S2.

---

# Part II — The design bar

MTP-08 and MTP-09 are the plans that fail a product for being unfinished rather than broken. Run
MTP-08 on Env A against a freshly seeded database (it used to run on the retired browser demo);
run MTP-09 wherever the operator can be given a real task.

---

## MTP-08 — Control, state, and consistency sweep

**Environments:** A (seeded), C to confirm anything suspicious · **Duration:** ~150 min ·
**Cadence:** every release, and after any change to `globals.css` or `ui-kit.tsx`.

**Objective.** Inventory every interactive control on every surface and hold each to §0.7. This is
the plan that catches unstyled dropdowns, mismatched date pickers, missing focus rings, and empty
states nobody designed.

### §1 The inventory

Fill one row per (surface, control type). 30 surfaces × the controls each carries.

| Surface | Control | From the kit? | States (D2) | Keyboard (D3) | Theme (D8) | Notes |
|---|---|---|---|---|---|---|
| Forms list | buttons, filters, search | | | | | |
| Form builder (×6 steps) | selects, inputs, drag, toggles | | | | | |
| Visibility / routing editors | selects, condition rows | | | | | |
| Public CFP wizard (×4 steps) | all 8 field types, OTP | | | | | |
| Abstracts table | tabs, filters, bulk bar, pager | | | | | |
| Abstract drawer | answers, decision controls | | | | | |
| Add-abstract modal | select, inputs | | | | | |
| Evaluation plans / plan editor | selects, datetime | | | | | |
| Assignment drawer | pickers | | | | | |
| Reviewer queue | scoring controls | | | | | |
| Agenda grid + session dialog | selects, datetime, drag | | | | | |
| Auto-place preview | list, accept/reject | | | | | |
| Ready-to-announce modal | copy rows, links | | | | | |
| Speakers list + detail | table, filters, invite | | | | | |
| Speaker roster panels | datetime, selects | | | | | |
| Tasks admin + task editor | date input, selects | | | | | |
| Task forms list + editor | field editors, selects | | | | | |
| Files admin | selects, upload, export | | | | | |
| Communications (6 tabs) | tabs, editor, selects | | | | | |
| Resources admin | table, editor | | | | | |
| Embeds | config, color input | | | | | |
| Event settings | tabs, selects, inputs | | | | | |
| Event settings → API keys | table, create/revoke dialogs | | | | | |
| Dashboard | select, cards, queue | | | | | |
| Command palette | search, results, shortcuts | | | | | |
| Portal (home/tasks/profile/submissions) | uploads, forms | | | | | |
| Speaker share page (`/speaking/<token>`) | links, share actions | | | | | |
| Public pages (×5) + embeds | filters, search, star | | | | | |
| Sign-up and account (`/signup`, `/join`, `/account/sessions`) | forms, revoke | | | | | |
| Org: team, audit, billing, CRM (×4) | tables, dialogs, pipeline | | | | | |

### §2 Targeted probes

| # | Probe | Expected | Today |
|---|---|---|---|
| 1 | Open every dropdown in the admin and compare to the public sessions page's filter dropdown | One dropdown design across the product | DD-1 regression: kit chevron and states agree; native keyboard/touch behavior remains |
| 2 | Count how many distinct ways the product asks for an instant | One zoned `DateTimePicker`; date-only public questions are separate | DD-2 regression: no raw admin `date`/`datetime-local` controls |
| 3 | Tab through every screen without touching the mouse | Every control reachable, visible ring, logical order, `Esc` closes overlays, focus returns to trigger | |
| 4 | Trigger every empty state (new event, no submissions, no sessions, empty queue, no contacts, no results after filtering) | Each names the next action | |
| 5 | Trigger every error state (offline, 500, validation, permission, stale write) | Each is specific and recoverable; none is "Something went wrong" | |
| 6 | Trigger every loading state | Skeleton or spinner with no layout shift when data lands (D7) |
| 7 | Screenshot each surface at 390 / 768 / 1280 / 1920 | No horizontal page scroll, no overlap, no clipping; wide tables scroll internally | |
| 8 | Toggle the theme on every surface | Nothing stays light in dark; no unreadable muted text; no hardcoded hex | |
| 9 | Grep the running UI for raw enum values and ids | No `accept_queue`, no bare UUID, no `file_request` on screen | |
| 10 | Compare button hierarchy across surfaces | Primary/secondary/danger used the same way everywhere; one primary per view | |
| 11 | Compare table behavior across the six list surfaces | Same sort affordance, same pagination, same empty state, same row-click behavior | |
| 12 | Compare destructive confirmations | All name what is lost and what survives | |
| 13 | Zoom the browser to 200% | Usable; nothing clipped (WCAG 1.4.4) | |
| 14 | Run the page through a screen reader on three surfaces (a table, a dialog, the wizard) | Landmarks, labels, and live regions announce; a dialog announces its title on open | |
| 15 | Disable CSS animations / prefers-reduced-motion | Nothing depends on motion to be understood | |

### §3 The `kitchen-sink` cross-check

`/kitchen-sink` and `/kitchen-sink/rich` render the primitives in isolation.

| # | Action | Expected result |
|---|---|---|
| 16 | Compare each kitchen-sink primitive to its in-app usage | Identical rendering. A drift means a surface has re-implemented a primitive |
| 17 | List the primitives the kitchen sink does **not** show | Each absence is a gap in the design system; `Select` is present and matches in-app use (DD-1 regression) |

### Exit criteria

The inventory is complete, every S1/S2 is filed with a screenshot and a D-number, and DD-1/DD-2 are
verified fixed. A release with an open S1 on any core-flow surface does not ship.

---

## MTP-09 — Task-based usability with step budgets

**Environments:** A · **Duration:** ~120 min for eight tasks · **Operator:** someone who has **not**
used Openboard. If that is impossible, the next best thing is someone who has not used the surface
under test in a month. The person who built the feature may not run the task and may not speak.

**Objective.** Measure whether the product's intended paths are the paths a competent user actually
finds. Functional plans ask "can it be done"; this one asks "is it done the way a person would try".

### Protocol

1. Give the operator the task in one sentence. Do not name a screen, a button, or a menu.
2. Start a stopwatch. Record: elapsed time, number of distinct surfaces visited, number of times a
   form was abandoned and restarted, number of times the operator backtracked, and every "wait, how
   do I…" said aloud.
3. Do not answer questions. When the operator is stuck for **90 seconds**, record a **fail**, then
   give the minimum hint and continue so the rest of the task still gets measured.
4. Compare against the budget. Over budget = a D10 finding at the severity in the table.

### The tasks

| # | Task (read verbatim to the operator) | Budget | Fail = |
|---|---|---|---|
| 1 | "A keynote speaker, Dr. Amara Osei of Kwame Labs, has agreed to speak. She never applied. Get her talk on the schedule for Tuesday at 9am on the Main Stage." | **≤ 4 min, ≤ 2 surfaces, 0 restarts** | **S1.** DD-3 regression |
| 2 | "Open the call for speakers so people can apply, and give me the link to share." | ≤ 6 min, ≤ 2 surfaces | S2 |
| 3 | "These five talks are in. Reject them and make sure the speakers are told." | ≤ 5 min, ≤ 2 surfaces | S2 |
| 4 | "The 2pm workshop has to move to 4pm. Do it, and make sure everyone who needs to know, knows." | ≤ 4 min, ≤ 2 surfaces | S2 |
| 5 | "Which accepted speakers still haven't sent their slides?" | ≤ 3 min, ≤ 2 surfaces | S2 |
| 6 | "The schedule is final. Put it on the website." | ≤ 3 min, ≤ 2 surfaces | S2 |
| 6a | "Three speakers still owe us slides. Chase them, and get me a zip of what has come in." | ≤ 5 min, ≤ 2 surfaces | S2 |
| 6b | "This keynote speaker has pulled out. Take them off the public site without deleting anything." | ≤ 4 min, ≤ 3 surfaces | **S1** if the operator cannot do it without deleting a session or a person |

### §2 First-run walkthrough

| # | Action | Expected result |
|---|---|---|
| 7 | Hand the operator a brand-new event (or **Empty Conf**) and say: "Set this up so speakers can apply." | They reach a published CFP without help. Every empty state they pass through should have pointed at the next step (D5/D10) |
| 8 | Record every screen where they stopped and read | Those are the screens whose empty states are doing the teaching. Any screen where they stopped and *backtracked* is a finding |

### §3 The seams

The core flow crosses four surfaces. Seams are where tasks die.

| # | Seam | Question | Expected |
|---|---|---|---|
| 9 | Form published → first submission arrives | Does the organizer find out? | Some signal without polling Abstracts |
| 10 | Submission accepted → speaker knows | Is notification an obvious next step from the decision, or a separate errand? | Obvious and adjacent |
| 11 | Accepted → scheduled | From Abstracts, is there a route to scheduling? From the Agenda, is there a route to what is unscheduled? | Both directions exist |
| 12 | Scheduled → published | Is the difference between "on my agenda" and "on the website" unmistakable? | Yes — publication state is legible at a glance |
| 13 | Published → changed | After a change, is the "tell people" step offered, or must it be remembered? | Offered |
| 14 | Published → announced | Having published, does the operator find the links, embed snippet and per-speaker share cards without being sent hunting? | On the surface where publishing happened, and only once there is something to announce |

### Exit criteria

Every task is inside budget. Task 1 is the headline DD-3 regression check.

---

# Part III — Supporting surfaces

Regression plans for the surfaces a conference is *served through* — bring-up, sign-in, the speaker
portal, the public pages, the mail, and the commercial layer around an event. §0.7's design bar
still applies; the release threshold outside the core flow is zero S1.

Part IV takes the surfaces an organizer *works in* between those milestones, and the boundaries
underneath all of them.

---

## MTP-01 — Environment bring-up, seed integrity, and smoke

**Environments:** A, then C · **Duration:** ~45 min · **Prerequisite for every other plan.**

| # | Action | Expected result |
|---|---|---|
| 1 | `pnpm install` on a clean clone | Completes; `pnpm@11.21.0` resolved |
| 2 | `pnpm dev` with **no** `.dev.vars` | The dev server boots and `/` renders — the landing page needs no database. (Until 2026-08-12 this step continued into a credential-free browser demo; that mode is deleted) |
| 3 | With still no `.dev.vars`, open `/events` | Redirected to sign-in, or a database error — **never** a fixture-rendered screen. Nothing in the app renders without Postgres |
| 4 | Stop the server | — |
| 5 | Fill `.dev.vars` per §0.2; `pnpm db:migrate` | Applies through the journal; re-running is a no-op |
| 6 | `APP_ENV=local pnpm seed --wipe` | `wiped N tables`, a line per module, row counts, credentials, both event ids. Exit 0 |
| 7 | `pnpm seed` again without `--wipe` | Idempotent — identical row counts, no duplicate-key error |
| 8 | Omit `APP_ENV`; run `pnpm seed` | Refused, naming the missing classification |
| 9 | `pnpm admin:bootstrap` | Organizer and reviewer accounts created |
| 10 | `curl -s localhost:3000/api/health \| jq .` | A real database round-trip — status, Postgres version, latency — plus the build sha and deployment id every cache check in these plans compares against, and three subsystem readings: comms, operational errors, and scheduled-job liveness |
| 10a | Read the scheduled-job section after driving a tick (§0.3) | It carries the last success time for `outbox`, `reminders` and `cleanup`. That is a durable heartbeat written before the job reports success, so a job that has silently stopped shows here as an ageing timestamp rather than as nothing at all |
| 10b | Confirm what the endpoint does **not** carry | Aggregates only — no tenant name, no recipient, no job payload. It is unauthenticated, so anything identifying in it is a leak, not a diagnostic |
| 11 | Sign in as organizer | Lands on an event surface with the four nav groups |
| 12 | Open the seeded Dashboard | Non-empty: counts, attention queue, the five incomplete speakers |
| 13 | Open **Empty Conf** and click every nav item | A deliberate empty state everywhere. No crash, no `NaN`, no endless spinner. **Record D5 on each** |
| 14 | `pnpm typecheck && pnpm lint && pnpm architecture:check && pnpm schema:check && pnpm invariants && pnpm test` | All green; record the vitest count. This is the credential-free set CI runs on every PR, and `pnpm check` is the same list plus both builds |
| 14a | Note which engine `pnpm test` chose | With Docker running it starts a pinned Postgres container and removes it afterwards; with `TEST_POSTGRES_URL` exported it uses that server untouched; with neither it prints the PGlite notice on stderr and runs the slow path. `pnpm test:pglite` forces PGlite regardless. A run that silently takes far longer than the last one is usually this, not a regression |
| 15 | *(C)* `bash scripts/post-deploy-smoke.sh <baseUrl>` | All checks pass; any skip names its reason |
| 16 | *(C)* `curl -s <baseUrl>/api/health` | Same shape as step 10, with the deployed sha |

**Known gaps.** Step 15 tests the artifact, not the pipeline — the `Deploy` workflow covers the
pipeline on every merge to `main`.

---

## MTP-02 — Admin authentication, sessions, and throttling

**Environments:** A, **C for the throttle** · **Duration:** ~40 min

| # | Action | Expected result |
|---|---|---|
| 1 | Visit an event URL signed out | Redirect to `/login`, return path preserved |
| 1a | Signed out, open a deep link under `/organizations` and one under `/account` — an audit log, a CRM contact, a billing page, `/account/sessions` | Sign-in returns you to the page you asked for, not to the organization picker. These four prefixes are exactly the middleware matcher; a page outside it silently falls back |
| 2 | Wrong password | Generic failure — does not distinguish "no such user" from "wrong password" |
| 3 | Correct sign-in as organizer | Reaches the event; footer shows name and **Organizer** |
| 4 | Sign out, then press Back | No authenticated page is restored |
| 5 | Sign in as the reviewer | Only **Review queue** in the nav; role reads **Reviewer** |
| 6 | Reviewer hand-types `/events/<eventId>/settings` | Denied |
| 7 | Reviewer hand-types the other event's dashboard | Denied — scoping is per-event membership |
| 8 | `/login/forgot` with the organizer's address | A form, and a confirmation identical whether or not the address exists |
| 9 | Drain the outbox; read the log | A reset message with a working `/login/reset?token=…` link. The token is redacted in the log's stored copy |
| 10 | Use the link; set a new password; reuse the link | Reset succeeds; the link is single-use |
| 11 | Sign in with new, then old password | New works; old rejected |
| 12 | Two browser profiles signed in; open `/account/sessions` | Both listed with device and time — these are real `admin_sessions` rows |
| 13 | Revoke profile #2 from #1; reload #2 | Signed out on the next request — server-side revocation, not just a cleared cookie |
| 14 | **Sign out everywhere** | Every session including the current one ends |
| 15 | *(C)* Six wrong-password attempts, at least one second apart | Five `401`s then `429 RATE_LIMITED` from the durable throttle |
| 16 | *(C)* `pnpm probe:auth-capacity <baseUrl>` | Twelve unpaced attempts return only `401`/`429`, at least eleven are `429`, p95 is at most 5 s, and no Worker `1102`/`503` escapes |
| 17 | *(Optional, needs Google credentials)* Google sign-in | Round-trips through `/api/auth/callback/google` |
| 18 | `POST /api/test/login` | `404`; the retired session-minting backdoor does not exist |

**Design checks.** §0.7 on `/login`, `/login/forgot`, `/login/reset`, `/account/sessions`. D4 matters
most here: an auth error that is vague is a support ticket.

The Deploy workflow runs step 16 after every preview deployment and blocks production promotion on
failure. See `docs/runbooks/sign-in-capacity.md` for budgets, log fields, and incident response.

---

## MTP-10 — Speaker portal

**Environments:** A, **C for uploads** · **Duration:** ~55 min

| # | Action | Expected result |
|---|---|---|
| 1 | Open the portal signed out | Redirect to that event's portal login |
| 2 | Request a code for `ada@openboard.events` | Neutral copy. Env A shows the fallback OTP and magic link |
| 3 | Six wrong codes | Rejected; the sixth is refused on attempt limits |
| 4 | Request a code for an address not on file | Same neutral message — no enumeration |
| 5 | Four code requests in a row | The fourth is throttled (3/10 min per contact) |
| 6 | Sign in with the correct code | Portal home: this speaker's tasks, submissions, outstanding items |
| 7 | Use the magic link from another browser; then reuse it | Works once; replay refused |
| 8 | Edit and save the profile | Persists across reload |
| 9 | Upload a headshot | Presign → PUT → finalize; the image renders from `/f/<fileId>` |
| 10 | `curl -I` that `/f/<fileId>` | `200`, right content-type, `cache-control: public, max-age=31536000, immutable` |
| 11 | Upload a disallowed type / oversize file | Rejected before the PUT, naming the limit |
| 12 | Complete the **file-request** task | Flips to complete; the organizer sees the file under **Files** |
| 13 | Complete the **manual** task | Flips to complete; the home count drops |
| 14 | Complete the **form** task | Real form fields, same validation as the CFP renderer |
| 15 | Open the overdue task | Visibly flagged as overdue |
| 16 | Open Resources; hand-type the unpublished page's slug | Published render sanitized; unpublished 404s |
| 17 | Open Submissions → detail | Status, code, and answers match the organizer's view |
| 18 | Change data as organizer; return to the portal tab | Refreshes on focus rather than showing stale data |
| 19 | Organizer → Speakers → Ada → **Open portal as Ada** | Portal opens with a persistent impersonation banner naming the admin |
| 20 | Act while impersonating, then exit | The action is attributed to the admin; exiting restores the admin session |
| 21 | Repeat 1–6 and 12 at 390×844 | No sideways scroll on home, list, or detail |
| 22 | Sign in to two different events' portals in one browser | Both sessions coexist; neither leaks the other's tasks |
| 23 | Follow an unsubscribe link and confirm | Recorded as a suppression (enforcement is MTP-12 step 8) |
| 24 | Sign in as a speaker with an **accepted** submission on a published schedule | The portal home offers their "I'm speaking!" share link. A speaker with nothing accepted is not offered one |
| 25 | Open that link in a private window; then paste it into a chat client that unfurls links | The page and its preview carry the speaker's name, talk and event — and no email address. A nameless contact reads **Unnamed speaker**: `first_name`/`last_name` default to empty, so anyone created from a submission or an invitation is nameless until somebody types one in |
| 26 | Reopen the same link after someone else has already opened it | Still works. It is a share link, not a one-shot token — a speaker who posts it expects it to keep working |

**Design checks.** §0.7 on portal home, task list, task detail, profile, resources, and the share
page — this is the surface a speaker sees, so S3s here cost more than elsewhere.

**Known gaps.** Step 12 has a recorded defect (M52) in the portal upload's `attach()` POST: the file
may land in R2 without the task flipping. Confirm before re-filing.

---

## MTP-11 — Public surfaces, embeds, calendar, and the public API

**Environments:** A for content, **C for headers** · **Duration:** ~55 min · **Precondition:** MTP-07.

| # | Action | Expected result |
|---|---|---|
| 1 | Visit `/e/<slug>/{sessions,agenda,itinerary,speakers,gallery}` | Each of the five public surfaces renders published content |
| 1a | Visit the legacy `/e/<slug>/schedule` and `/embed/<slug>/schedule` | Redirected — the page surface to `/agenda`, the embed to `/itinerary`, which is the one that reads the same config row, so an iframe already placed on somebody's website keeps its kill switch and style. Old links must not 404 |
| 2 | On sessions: search + Track/Format/Location filters | Each narrows the same grid; they compose |
| 3 | On agenda: navigate days, open and close a detail | The active day survives |
| 4 | On speakers: search a surname | One row with bio and sessions; surname sort |
| 5 | On gallery: find a speaker with no headshot | Initials fallback, not a broken image |
| 6 | On itinerary: star two, reload, unstar one, export ICS | Two after reload; the export has only the remainder |
| 7 | Import that ICS into a calendar client | Correct times for the event zone, with title, room, description |
| 8 | Compare one session and one speaker across all five surfaces and the admin | Everything agrees |
| 9 | Search for the draft session and a declined speaker on every public page, every embed, and both APIs | Absent everywhere |
| 9a | Clear a speaker's first and last name, then find them on the speakers page, the gallery, the session detail, the API, and their `/speaking/<token>` page | **Unnamed speaker** on every one of them. An email address standing in for a missing name is the admin roster's rule; on a public surface it publishes the address, and the share page's OpenGraph card gets scraped and cached by whoever sees it first |
| 10 | Open a portal invite's `/cal/<token>` | A valid subscribable feed |
| 11 | Move a published session; refetch | Reflected; a deletion appears as a cancellation |
| 12 | `/cal/not-a-real-token` | Rejected — feeds are token-authorized |
| 13 | Change an embed style/filter; save; reload the embed | Takes effect on next load |
| 14 | Toggle the embed kill switch | Stops serving content |
| 15 | Frame an embed cross-origin | Renders; no `X-Frame-Options` |
| 16 | *(C)* Request a public page and an embed until regeneration settles | A fresh response has `s-maxage`, or a cached response reports `x-nextjs-cache: HIT`; `STALE` alone is not a pass, and each body marker matches `/api/health`'s unique deployment id |
| 17 | Unauthenticated `/api/v1/events/<slug>`, `/schedule`, `/speakers` | `200`, published rows only |
| 17a | Unauthenticated `/api/v1/events/<slug>/schedule/ics`, then again with `?session=<id>` | A valid calendar file for the published schedule, and for the one session. `no-store` — this is a file, not a cacheable JSON document |
| 18 | `Authorization: Bearer nope` on `/stats` | `401` in the documented envelope — **before** any 404 for a bad slug |
| 19 | Valid key on `/stats` | `200`; agrees with the dashboard |
| 19a | Valid key on `/speakers/outstanding-tasks` | The same rows the dashboard's chasing list shows — it reads the same view |
| 19b | Valid key on `/comms-log`, with and without `limit` | Delivery records only: never a rendered body or subject line. `limit` defaults to 50 and clamps at 200 |
| 20 | `/submissions?limit=1` then follow `meta.nextCursor` | Pages cleanly; no drafts; no repeats |
| 21 | Revoke the key; repeat 19 | `401` immediately |
| 22 | Event A's key against event B | `401`/`404` — keys are per-event |
| 23 | All five surfaces for **Empty Conf** | Deliberate empty states |
| 24 | All five at 390 px | Usable; no horizontal scroll |

**Design checks.** §0.7 on all five public surfaces and their embeds. These are the pages an attendee
sees; D7 and D8 failures here are public.

---

## MTP-12 — Communications, reminders, and delivery compliance

**Environments:** A, **C for delivery** · **Duration:** ~65 min

| # | Action | Expected result |
|---|---|---|
| 1 | **Communications → Delivery log** | The seeded log: recipient, subject, template, status, time |
| 2 | Search by recipient and subject | Narrows; clearing restores |
| 3 | Open one entry | Full detail including rendered body and delivery state |
| 4 | **Templates** — confirm all 11 event-editable templates | Each with a description of its trigger. Three of the 14 template keys are platform templates and are deliberately absent: the two admin-auth ones (password reset, email verification) and the organization invitation. Editing one of those through the API is refused, not accepted-and-ignored |
| 5 | Edit a body with `<script>` plus a legitimate `<a href>`; save | Script stripped, link kept; the UI confirms sanitization |
| 5a | Put `<a href="{{portal.magic_link}}">Open your speaker portal</a>` in a template body, save, and reload | The token survives the save. Sanitizers drop any `href` that is not http(s)/mailto, and a merge token is neither — so a body stored through the wrong sanitizer reaches every recipient as link-less text |
| 5b | Do the same in **bulk send**'s composer and in the form builder's confirmation email, whose shipped default is built around that exact link | Same result in both, and the token is still there while you are typing, not stripped under the cursor |
| 6 | **Preview** | Renders with sample data — no raw `{{tokens}}` |
| 7 | **Bulk send** to a segment | One row per resolved recipient; the shown count matches |
| 8 | Suppress one recipient; send again | Skipped, with the reason recorded — not counted as sent |
| 9 | Inspect a delivered message | `List-Unsubscribe` present |
| 10 | Follow unsubscribe and confirm | Suppressed; later sends skip it |
| 11 | Enable a reminder ladder with an overdue offset | Saved; shows Active |
| 12 | Pause it | Shows Paused; the next scan enqueues nothing for it |
| 13 | Re-activate; trigger the private scheduler on a 15-minute tick | Reminders for overdue items only |
| 14 | Trigger another eligible tick | No duplicates in the same window |
| 15 | `POST /api/jobs/outbox` on the public web origin, then `POST /worker-jobs/outbox` **on Env C** — with and without the private header | `404` every time. The retired public callback does not exist, and the private path is refused by the deployed Worker's public entrypoint before OpenNext routing, so no header gets you in from the Internet |
| 16 | Drain and read the log | Each message rendered once, with template and idempotency key |
| 16a | Read the **text/plain** alternative of a message that contains links | Each link's destination is beside its label — `Open your speaker portal (https://…)` — including the layout's unsubscribe line. Stripping tags takes the `href` with them, and a client that renders text/plain then shows an email whose every call to action is inert. The subject line and the ICS descriptions deliberately keep the plain text |
| 16b | Send a template containing `{{speaker.last_name}}` to a contact with no surname (most contacts created from a submission or an invitation have none) | Delivered, with the surname rendering as nothing. An empty value is not a missing variable: a missing one fails the message permanently, on the first attempt, with no retry — which would mean one ordinary greeting silently failing every message to half the roster |
| 17 | Publish a session; drain | A **Schedule assigned** message ("You're scheduled: …") with ICS and Google/Outlook deeplinks |
| 18 | Move it; drain | **Schedule changed** replaying the update — not a duplicate invite |
| 19 | Signed bounce payload to `/api/webhooks/resend` | Accepted; recipient marked bounced and suppressed |
| 20 | Same payload, bad signature | Rejected |
| 21 | Complaint payload | Recorded and suppressed |
| 22 | Deliverability panel | Reflects 19–21 |
| 23 | *(C, `EMAIL_MODE=send`)* Send to an allowlisted inbox | Delivered from the verified domain; `dmarc=pass`, SPF/DKIM aligned |

### The cleanup tick

`cleanup` is the 09:00 UTC job. Drive it by hand with the `curl` in §0.3 rather than waiting.

| # | Action | Expected result |
|---|---|---|
| 24 | Run `cleanup` and read its stats | One number per sweep — orphans, retention, stalled exports, expired exports, operational errors — and a sweep that fails does not erase what its siblings did |
| 25 | Age a delivered message past 90 days and re-run | The record survives as the audit trail; the rendered subject, body and sealed payload do not. The recipient address stays — bounce and complaint lookups are keyed on it |
| 26 | Do the same for a password-reset or verification message in the platform outbox | Redacted on the same boundary and by the same rule. This mailbox holds the sealed link on a failed row, so an unaged one keeps every reset credential it ever sent |
| 27 | Start a file export, kill the browser tab before it finishes, and run `cleanup` | The job is picked up and driven forward. A job that never left `pending` because nothing polled it is exactly the case the sweep exists for; it must not sit until it expires and is pruned 24 hours later with the organizer never getting the ZIP |
| 28 | Queue more stalled exports than one tick takes (20) | The oldest twenty are worked and the remainder are reported as deferred, not silently dropped and not run serially past the tick's budget |

**Known gaps.** A production Outlook `portal_login` probe on `2026-08-15` passed SPF, DKIM, DMARC,
and composite authentication but landed in Junk; that is the OTP placement baseline. A later Outlook
authentication failure or placement worse than that recorded baseline is a regression. The matching
Gmail probe passed authentication, and its folder placement was Inbox.

Calendar REQUEST/reschedule/CANCEL now has a repeatable **send** path: the **Production mail
delivery probe** workflow (`workflow_dispatch`, protected `production` environment, `pnpm
probe:calendar-delivery`) creates a temporary session on a real production event, reschedules it,
deletes it, and waits for all three messages to reach `sent` with the expected `last_method` for
both recipients. That is Resend *accepting* the message and the invite state machine advancing —
the probe never opens a mailbox, so a later bounce, rejection, or a Junk landing passes it.

Run it against a Gmail and an Outlook inbox you own, then **read both inboxes by hand**: SPF, DKIM,
DMARC, whether the calendar item actually attached, and which folder it landed in. That reading is
the calendar placement baseline the way the `portal_login` probe is the OTP one, and it stays
manual. Outlook calendar placement has no recorded baseline yet.

Production forbids `EMAIL_FALLBACK_UI=1`; a credential appearing in a production-mode render is
a P0.

---

## MTP-13 — Commercial layer: organizations, team, GDPR, billing, CRM

**Environments:** A · **Duration:** ~60 min

`/signup` uses Better Auth's email-signup endpoint in every environment. Configure Google only if
you also want to exercise the optional social-signup path.

Billing is outside the deployed launch scope while only the stub provider exists. Steps 17–18
require an explicit local `BILLING_MODE=scaffold`; preview and production validation reject that
mode, hide the navigation entry, and return 404 from the billing surface.

| # | Action | Expected result |
|---|---|---|
| 1 | `/signup` with a fresh address | Account and named workspace created without a session; **Check your inbox** names the address and offers resend/restart recovery |
| 2 | Follow the delivered link, explicitly confirm, then complete guided event/form setup | A session starts only on confirmation; the organization, first event and public CFP are ready without operator provisioning |
| 3 | `/organizations` | Your new org listed |
| 4 | Hand-type another org's URL | Denied |
| 5 | Hand-type an event id from another org | Denied |
| 6 | **Team** → invite an address as reviewer | Listed pending with its role |
| 7 | Accept the invite at `/join` in a private window | Joins with **exactly** the invited role |
| 8 | Reopen the same invite link | Refused — single use |
| 9 | Revoke a pending invitation; open its link | Refused |
| 10 | Change a member's role, then remove them | Access changes on their next request |
| 11 | Remove the last owner | Refused |
| 12 | **Audit log** | Steps 6–11 with actor, action, target, timestamp |
| 13 | Filter by actor and action | Narrows; entries are not editable |
| 14 | Request a data **export** | A machine-readable file with the org's real rows |
| 15 | Request **erasure** for a test contact | Data removed or tombstoned; no orphans, no 500s on pages that referenced them |
| 15a | Before erasing, merge two duplicates into that contact — and a third into one of those, so the chain is two deep | The erasure takes the tombstoned losers with it. A merge is the organizer asserting these are one person; the losing row keeps their name, company and alternate email, so an erasure that only touches the surviving row leaves the subject's data on file under a pointer |
| 15b | Erase a contact who has submissions, sessions, tasks, uploads and delivery-log rows | Every surface that referenced them still renders — the schedule, the abstracts table, the delivery log — with the person's identity gone rather than the row. A 500 on a page that used to show them is the failure this step exists for |
| 16 | Re-run the export | The erased contact's data is gone |
| 17 | **Billing** | The plan/quota scaffold renders; checkout starts its documented flow |
| 18 | Billing webhook with a garbage payload | Rejected |
| 19 | `/organizations/<orgId>/crm` | Org-level directory across events |
| 20 | Create a contact | Appears in the directory |
| 21 | Import a CSV with one duplicate and one malformed row | A preview reports creates/updates/rejects before committing; the malformed row is rejected with its line number |
| 22 | Add a custom field; set it on two contacts | Persists and filters |
| 23 | Build a segment from tag + custom field | Resolves to exactly the expected contacts |
| 24 | Move a contact between pipeline stages | Persists; metrics update |
| 25 | Preview a merge of two duplicates | Field-by-field, showing which value survives, before any write |
| 26 | Apply the merge | One contact remains with the union of notes/tags |
| 27 | **Recover** the merge | Reversed to the pre-merge state |
| 28 | CRM bulk email to a segment | One per member, minus suppressed; count shown before sending |
| 29 | Push a contact to an event roster | Appears under that event's **Speakers** |
| 30 | CRM metrics | Agree with the directory and pipeline |

### MTP-13a — `/events/new` workspace routing

Use accounts with the memberships named below. These cases exercise later event
creation separately from the first-event path in MTP-13 step 2.

| # | Action | Expected result |
|---|---|---|
| 1 | Signed out, open `/events/new` | Redirected to `/login?next=%2Fevents%2Fnew`; signing in returns to event creation |
| 2 | Signed in with owner/organizer access to exactly one workspace, open `/events/new` | Redirected directly to that workspace's guided onboarding; the event is owned by that workspace |
| 3 | Signed in with owner/organizer access to two workspaces, open `/events/new` | An explicit workspace chooser appears; reviewer-only memberships are absent; the selected workspace opens guided onboarding |
| 4 | Signed in with reviewer-only memberships, open `/events/new` | No global event form appears; a permission recovery explains that organizer access is required and offers **View your workspaces** |

**Known gaps.** M55 (CRM) landed partial; billing is a local-only scaffold by design. Steps 17–18
test that it does not lie about what it does.

---

# Part IV — The operational surfaces

Part I follows one talk from a proposal to a published slot. Part IV is everything the organizer
does *around* that talk once it exists: chasing the slides, keeping the roster straight, setting the
event up in the first place, and the boundaries that keep one tenant's data out of another's screen.

These four are the plans for the surfaces the core flow leans on and never exercises hard. §0.7's
design bar still applies; the release threshold here is zero S1, as in Part III.

---

## MTP-14 — Tasks, deliverables, and the Files desk

**Environments:** A, **C for uploads and CORS** · **Duration:** ~75 min · **Precondition:** MTP-06,
so accepted submissions and confirmed speakers exist. Assignment is derived from acceptance — on an
event with nothing accepted, every table in this plan is legitimately empty.

**Objective.** Prove that a task reaches exactly the people it should, that a file arrives with its
history intact, that the export hands back what was selected at the moment it was selected, and that
a private file is private.

### §1 Authoring a task

| # | Action | Expected result |
|---|---|---|
| 1 | Create a **manual** task targeted at **contacts** | It appears for every accepted speaker — not every contact. Count the assignments against the accepted-speaker list and expect them to agree |
| 2 | Create a task targeted at **submissions** | One assignment per accepted submission, to that submission's **primary** participant only. A co-speaker does not receive a second copy of the same task |
| 3 | Withdraw or decline one of those submissions | Its assignment leaves the list. Assignment follows acceptance rather than a snapshot taken when the task was written |
| 4 | Set a due date, then check it from a workstation in another timezone | It is a **date**, not an instant, and it falls due at the end of that day in the **event's** zone. A task due "Friday" that turns overdue on Thursday evening for the organizer is a D9 failure |
| 5 | Create a **form** task without choosing a form, and a **file** task without a file request | Refused, naming the missing half. The mode and its target must agree |
| 6 | Deactivate a task | It leaves every assignee's list without deleting anything; reactivating restores it, and any completion recorded in between survives |
| 7 | Complete the task as one speaker, then try to change its target type, completion mode, form, or file request | Refused — the structure is frozen by the responses that exist, the same way a form with submissions freezes. **Repeat the attempt as a `PATCH` against the API**, because the button being disabled is not the guard |
| 8 | Change the task's name, description and due date after that completion | Allowed. Copy and deadlines stay editable; only the shape locks |
| 9 | Edit one task in two tabs and save both | The second save is refused on the concurrency check, not applied over the first |
| 10 | Reopen a completed assignment from the admin | The completion clears, the speaker sees the task open again, and the counts on the dashboard and portal home move with it |

### §2 The Files desk

The Files view is one row per **slot** — the `(file request, contact, submission)` triple a request
opens. Everything below reads and writes that one slot from two directions.

| # | Action | Expected result |
|---|---|---|
| 11 | Open **Files** with a file-request task assigned | One row per slot, showing the latest version, the version count, and the comment count |
| 12 | Work each filter: open, overdue, completed, has-upload, still-empty, a due-date range, and the search box | Each narrows the same table, and they compose. **Overdue** and **completed** must never both be true for one row |
| 13 | As the speaker, upload a second file into a slot that already has one | Version 2, numbered, marked latest. Version 1 is still listed and still downloadable — a re-upload is a new version, never an overwrite |
| 14 | Leave a comment as the organizer; answer it as the speaker from the task detail | Both land in the same thread, in order, attributed. The speaker's half and the organizer's half are two doors into one slot |
| 15 | Select several rows and send **Remind** | One reminder per selected target, reported as a count. A suppressed or unsubscribed recipient is skipped with its reason, not counted as sent |
| 16 | Select more rows than the bound allows — 200 for the table and the export, **20** for one reminder send | Refused with the limit named, before anything is enqueued — not a partial batch. The two numbers differ on purpose: an export is one insert, while each reminder target keeps its own commit boundary |
| 17 | Sort and paginate, then take a bulk action | The action applies to your actual selection, not to the visible page (the same rule as MTP-06 step 11) |

### §3 The ZIP export

| # | Action | Expected result |
|---|---|---|
| 18 | Select a set of slots and start an export | The response comes back immediately with a job, not a spinner holding the request open. The job advances step by step as you poll |
| 19 | **While the job is running, upload a newer file into one of the selected slots** | The ZIP contains the file that was latest when the job was *created*. An export that widens to a file uploaded after the request was made is the failure — the selection is frozen server-side, and a client-supplied "latest" claim is never trusted |
| 20 | Include two speakers who uploaded files with the same filename | Both are in the ZIP under distinguishable names. One silently overwriting the other loses a deliverable |
| 21 | Run the export once per **group by** option — none, session, speaker | The folder structure matches the choice; every selected file appears exactly once in each |
| 22 | Start an export and close the tab immediately | The job still finishes: the cleanup tick rescues one nobody is polling (MTP-12 step 27). This is the case that used to sit until it expired |
| 23 | Download a finished export, then wait past its expiry and use the same link | The contents match the selection. After expiry the link is gone with an explanation, not a raw error |
| 24 | Export a selection where one slot has no upload at all | Deliberate: either it is excluded and said so, or the ZIP names the gap. A silently short ZIP is S2 |

### §4 Who can read a file

| # | Action | Expected result |
|---|---|---|
| 25 | Request `/f/<fileId>` for a headshot or the event logo | `200`, the content type from the file record, and the immutable cache header (MTP-10 step 10) |
| 26 | Request `/f/<fileId>` for a **private** kind — a slide, an attachment, a file-request upload | The same `404` an unknown id gets. A private file must not be distinguishable from one that does not exist |
| 27 | Ask for `/api/uploads/<fileId>/download-url` as the organizer of that event | A short-lived presigned GET. This is the only door to a private file |
| 28 | Ask for the same file's download URL while signed in to a **different** event, and as a portal speaker who does not own it | Refused both times. The check is `(event, file, requester)` together — one event's session must never unlock another's file |
| 29 | Presign an upload that breaks its policy — wrong type, or over the size limit | Refused **before** the PUT, naming the limit. A file-request slot takes its extensions and size cap from the request itself, clamped by the global maximum |
| 30 | *(C)* Run a real presign → PUT → finalize from the browser | Works under CORS on a deployed origin. This is the step Env A cannot prove |

### §5 Design checks

Walk §0.7 on the tasks admin list, the task editor, the task-form editor, the Files table, the slot
drawer (versions and comments), the reminder confirmation, and the export progress state.
Specifically: **D2** on the export while it is running — a job that advances in steps needs a
progress state that is honest about not being finished; **D4** on Remind, which is a mass mail;
**D5** on Files before any request exists; **D9** on the due-date column.

### Exit criteria

Steps 1–3 (assignment reaches exactly the right people), 7 (the mode lock holds against the API),
13 (versions are additive), 19 (the export cannot widen), and 26–28 (private stays private). Zero
S1/S2 on the Files desk.

---

## MTP-15 — The speaker roster as an operations surface

**Environments:** A · **Duration:** ~60 min · **Precondition:** MTP-06.

**Objective.** Prove the roster is a place work gets done rather than a list: one person is one
contact however they arrive, the organizer's own pipeline is separate from the publication gate,
and the things an organizer records about a speaker survive and are usable.

### §1 One person, one contact

| # | Action | Expected result |
|---|---|---|
| 1 | Add a speaker by hand | A contact is created and appears on the roster |
| 2 | Add "another" speaker with the same address in different case and with surrounding spaces | The **same** contact is updated, not duplicated. Every entry point normalizes identity the same way |
| 3 | Import a CSV | A preview reports creates, updates and rejects **before** anything commits |
| 4 | Include a row whose email already exists, one malformed row, and one row missing a required column | The existing contact is updated; the malformed row is rejected with its line number; the good rows still commit. One bad line does not lose the file |
| 5 | Import the same file twice | The second run updates and creates nothing new |
| 6 | Import a row for someone who is already a speaker through the CFP | They merge into the same person — the roster does not grow a second copy of a submitter |

### §2 Two statuses that mean different things

`workflow_status` is the organizer's pipeline (new, contacted, invited, confirmed, declined,
withdrawn). `confirmation_status` is the publication gate — `published_speakers_v` requires
`confirmed`. They are deliberately distinct and the plan is here to keep them that way.

| # | Action | Expected result |
|---|---|---|
| 7 | Move a speaker through the workflow statuses | The roster's filters and counts follow, and **nothing about their public visibility changes** |
| 8 | Accept and notify one of their submissions (MTP-06 §3a) | Confirmation flips to confirmed; the workflow status stays exactly where the organizer left it |
| 9 | Set confirmation to **declined** by hand on a speaker whose session is published | They leave the public speakers list and gallery, while the session stays published. The organizer should be able to see that consequence before saving it (D4) |
| 10 | Re-accept that person's submission | They stay declined — a re-acceptance does not overrule the organizer (MTP-06 step 24c) |

### §3 Logistics fields

| # | Action | Expected result |
|---|---|---|
| 11 | Create a **text** logistics field and a **select** field with options | Both appear on every speaker's detail |
| 12 | Try to create a select field with no options | Refused before save |
| 13 | Set values on two speakers, then filter the roster by them | The filter resolves to exactly those speakers |
| 14 | Delete a field that has values | The confirmation names what is lost before it happens (D4), and afterwards no orphan value is left rendering on any screen |

### §4 Unavailability

| # | Action | Expected result |
|---|---|---|
| 15 | Add a blackout window for a speaker | The editor names the **event's** timezone at entry and renders it back in event-local time, with your clock elsewhere (D9) |
| 16 | Run **Auto-place** for a session with that speaker inside their blackout | The proposal names the unavailability as the reason rather than failing generically (MTP-07 step 26) |
| 17 | Add a second window that overlaps the first, and one that ends before it starts | Overlaps are handled deliberately; a backwards interval is refused |
| 18 | Delete the window and re-run Auto-place | The slot becomes available again |

### §5 Reaching the roster

| # | Action | Expected result |
|---|---|---|
| 19 | Invite a speaker from their detail page | They get a portal link. This is non-essential mail: a suppressed or unsubscribed contact is skipped with its reason (MTP-12 step 8) |
| 20 | Filter the roster and send a **bulk email** to the selection | The count is shown before sending and matches the rows that actually receive one |
| 21 | Export one contact's record | Machine-readable, and genuinely everything held about them: profile, their submitted answers, portal tasks, logistics values, blackout windows, uploaded-file metadata, file-slot comments, the messages sent to them **including the rendered body** where retention has not yet redacted it, calendar invites, their personalized copy of any bulk email, suppression status, and portal sign-in metadata |
| 21a | Search that export for a token or OTP hash | Absent. How the system authenticates someone is not their personal data, and exporting it would hand over a live credential |
| 22 | Push a contact to the org-level CRM and back (MTP-13 step 29) | One person on both sides; no duplicate appears in either directory |
| 23 | Open the speaker's portal as them (MTP-10 step 19) and check what they see of §3 | Organizer bookkeeping is organizer-only. A workflow status or an internal logistics note on a speaker's own screen is a privacy finding, not a cosmetic one |

### §6 Design checks

Walk §0.7 on the roster table and its filter tabs, the speaker detail page and each of its panels,
the logistics-field editor, the unavailability editor, the import preview, and the bulk-email
composer. Specifically: **D1/D9** on the unavailability editor (DD-2 regression); **D5** on a roster
with nobody on it; **D10** on the import preview — a rejected row should be fixable without starting
the whole import again.

### Exit criteria

Steps 2, 4 and 6 (one person is one contact, whichever door they came through), 7–10 (the two
statuses never move each other), and 23 (nothing internal leaks into the portal).

---

## MTP-16 — Event setup, vocabularies, and settings

**Environments:** A · **Duration:** ~60 min · **Precondition:** MTP-01. Use a **throwaway event**
for §1 and §2 — several steps here are refusals that need a schedule to push against, and one of
them deletes vocabulary.

**Objective.** Prove an event can be set up and then *changed* — dates, timezone, slug, tracks,
rooms — without silently invalidating what has already been built on top of it.

### §1 Creating an event

| # | Action | Expected result |
|---|---|---|
| 1 | Create an event with name, slug, type, dates and timezone | Created, and it opens on a surface that tells you what to do next (D5/D10) |
| 2 | Re-use an existing slug, then try a reserved one (`api`, `portal`, `e`, `embed`, `cal`, `f`, `login`, `admin`, `submit`, `assets`, `app`) | Refused both times — the slug is the public address, and the reserved list is the set of paths it would otherwise shadow |
| 3 | Enter a timezone that is not a real IANA zone | Refused. The zone list is the platform's own, not free text |
| 4 | Set the end before the start | Refused, on the field |

### §2 Changing an event that already has a schedule

| # | Action | Expected result |
|---|---|---|
| 5 | Change a date from the settings form | Accepted, if the bounds still fit. The form always sends starts, ends and timezone as one bundle, and that is the point — the three move together because sending two of them silently reinterprets every session already placed |
| 5a | Issue the same change as a hand-made `PATCH` that omits `timezone` | Refused, naming the field. The bundle rule lives on the route, not in the form; a client that sends half of it is the case the guard exists for |
| 6 | Shrink the dates so a scheduled session would fall outside them | Refused: *"These dates would leave scheduled sessions outside the event. Move or unschedule them first."* Then move that session inside the new window and repeat — it saves. The message names no session, so record how long it takes you to find the offending one on a full agenda; that is a D4 finding worth filing rather than a pass |
| 7 | Widen the dates | Accepted; the agenda grid grows and existing placements do not move |
| 8 | Save settings in two tabs | The second is refused as stale rather than overwriting the first |
| 9 | Change the timezone (with dates, per step 5) on an event with placed sessions | Record precisely what happens to each session's displayed time and to the public day tabs, on a workstation outside both zones. Whatever the product does here, it must be one thing and it must be legible before the save |
| 10 | Change the slug | The public pages answer on the new slug, the embeds and calendar feeds follow, and the old address does not keep serving stale content indefinitely. Note what an already-pasted embed snippet does |
| 11 | Upload a logo and a background, set the accent colour | The public site, the embeds and the branded email layouts all pick them up. A branding change that only lands in one of the three is a finding |

### §3 Vocabularies — tracks, rooms, formats, tags

| # | Action | Expected result |
|---|---|---|
| 12 | Create, rename and reorder each of the four kinds | The order is what the public pages and the pickers use, everywhere |
| 13 | Delete a **track** that a form's routing or visibility rule references, or that an evaluation round is scoped to | Refused, naming *where* it is still used — forms and rounds by name, not a count |
| 14 | Delete a **format** that is still in use | Refused the same way |
| 15 | Clear those references, then delete the track and the format | They go, and nothing that referenced them is left pointing at a dead id |
| 16 | Delete a **room** that has sessions in it, including one that is published and timed | Allowed, and it cascades in one statement: those sessions lose their room, the published-and-timed ones advance their schedule revision exactly once, and the room disappears from any embed's filter. Confirm each of the three |
| 17 | Drain the outbox after step 16, then open the affected speaker's calendar item | **No mail is sent by the deletion itself** — see Known gaps. The speaker's invite still names a room that no longer exists until that session is next saved, which is when the advanced revision finally ships. Record whether the organizer was warned before deleting (D4) |
| 17a | Save one of those sessions and drain again | *Now* a **Schedule changed** message goes out, carrying the room's absence — one per speaker, not a duplicate invite (MTP-12 step 18) |
| 18 | Delete a **tag** that is applied to submissions | Record what happens; a tag that vanishes from the vocabulary but survives on rows is a data finding |
| 19 | Rename a track that is on a published session | The public pages show the new name without needing a redeploy |

### §4 Access and API keys

| # | Action | Expected result |
|---|---|---|
| 20 | Open **Settings → API keys** and create one | The secret is shown **once**, at creation, with a warning that it will not be shown again |
| 21 | Reload the list | The key is listed by its metadata and the secret is nowhere in the response — check the payload, not just the screen |
| 22 | Replay the exact same creation request (the client retrying a lost response) | You get the *same* key back, not a second one. A retry that mints two live credentials is S1 |
| 23 | Revoke a key and use it (MTP-11 step 21) | `401` immediately |
| 24 | Add a member as reviewer from the event's access surface, then change their role and remove them | Their access changes on their next request, and the audit log records each move (MTP-13 step 12) |

### §5 Design checks

Walk §0.7 on the event-creation form, every settings tab, each vocabulary editor, and the API-keys
surface. Specifically: **D4** on every deletion in §3 — each must name what is lost and what
survives; **D9** on the date and timezone fields; **D2** on the one-time secret display (it is
useless if it can be dismissed by accident with no way back).

**Known gaps.** Deleting a room advances the schedule revision of every published, timed session
it strands but does not enqueue anything: the notification path belongs to the agenda's own save,
which this statement does not go through. Until a session is saved again, its speakers hold a
calendar item naming a deleted room. Steps 17 and 17a exist to keep that visible rather than to
re-file it each release — confirm it still behaves this way, and treat a *missing warning before the
delete* as the live finding.

### Exit criteria

Steps 5a, 6 and 8 (an event's shape cannot be changed out from under its schedule, whatever the
client sends), 13–16 (a vocabulary deletion either refuses or cleans up after itself, and never
leaves a dangling reference), and 20–22 (a secret is shown once and a retry does not mint a
second).

---

## MTP-17 — Tenancy, authorization, and id probing

**Environments:** A for the probing, **C for the throttles and the private paths** ·
**Duration:** ~75 min · **Cadence:** every release, and after any change to a route guard,
`middleware.ts`, or a query that takes an id from the client.

**Objective.** The rest of the document tests what the product does for the person using it. This
one tests what it does for someone using it against you. Every other plan checks its own surface's
scoping in passing; this one does it deliberately, in one pass, with a written inventory.

### §0 Setup

Two organizations, each with one event, and four identities: an owner in org A, an organizer in
org A's event, a reviewer in org A's event, and a speaker with a portal session on org A's event.
Nobody in this list has any membership in org B.

Then build the **id inventory** — this is the artifact the plan produces, and it is what makes the
sweep repeatable rather than a rummage:

| Kind | From event A | From event B |
|---|---|---|
| event, organization | | |
| submission, form, form version | | |
| session, room, track, format | | |
| contact, task, file request, file asset | | |
| evaluation plan, review assignment | | |
| API key, embed, resource page, portal token | | |

### §1 The admin surfaces

| # | Action | Expected result |
|---|---|---|
| 1 | As org A's organizer, hand-type every `/events/<eventId>/…` route with **event B's** id | Denied on every one. Not a partial render, not an empty table that looks like a real screen for an event you cannot see |
| 2 | Call each internal API route with event A's session and event B's ids in the body — including one id of each kind from the inventory | Denied. Route guards re-authorize on every request; the middleware redirect is a convenience and proves nothing |
| 3 | Mix the ids: event A's id with a submission id from event B, a session id with another event's room id | Denied. Every event-scoped row carries a composite key back to its event, so a mismatched pair is a database-level rejection rather than an application check — confirm that is what you observe |
| 4 | Compare the error for "does not exist" with the error for "exists but is not yours" | You cannot tell them apart. If you can, the API is an id oracle, and that is a finding even when nothing else leaks |
| 5 | As the reviewer, hand-type every organizer route on their **own** event | Denied — the reviewer has one surface (MTP-02 step 6, MTP-05 §3) |
| 6 | As the org A owner, open every `/organizations/<orgId>/…` route for org B | Denied, including the CRM contact detail, the audit log, and billing |

### §2 The portal and its tokens

| # | Action | Expected result |
|---|---|---|
| 7 | With a portal session on event A, hand-type event B's portal, task and submission URLs | Denied. Portal sessions are per-event by construction (MTP-10 step 22) |
| 8 | Replay a used magic link, and a code after its attempt limit | Refused (MTP-10 steps 3, 7) |
| 9 | Take another contact's task id into your own portal session | Denied — the assignment is the boundary, not the URL |
| 10 | Follow a `/cal/<token>` feed with the token altered by one character | Rejected (MTP-11 step 12) |
| 11 | Open a `/speaking/<token>` share link with an altered token, and one for a contact in another event | Not found. A share link is signed, not guessable, and it carries no more than the page it renders |
| 12 | Ask for an impersonation link from a different origin — the shape a cross-site page would forge, since the route mints a live portal token off nothing but the ambient admin cookie | Refused on the origin check. Then confirm the legitimate path: the session is badged, scoped to that one event's portal, attributed to the admin in the audit trail, and ends when you exit it (MTP-10 steps 19–20) |
| 12a | Ask for an impersonation link for a contact in the **other** event, and as a reviewer rather than an organizer | Refused both times |

### §3 Files, embeds, and the public edge

| # | Action | Expected result |
|---|---|---|
| 13 | Walk the file cases in MTP-14 §4 with the other event's session | Refused; a private kind is a `404` either way |
| 14 | Request an embed for an event with the kill switch on, and one for a draft resource page | Nothing served |
| 15 | Post a bounce webhook with a bad signature; then replay a *valid* one whose timestamp is more than five minutes old | Rejected both times. The signature covers id, timestamp and body together, and the five-minute tolerance is what stops a captured-and-replayed payload (MTP-12 steps 19–21) |
| 16 | Use event A's API key against event B's slug, and a revoked key | `401`/`404` (MTP-11 steps 21–22) |
| 17 | *(C)* `POST /worker-jobs/<job>` with and without the private header | `404` both ways — the private namespace is refused before OpenNext routing (MTP-12 step 15) |

### §4 The throttles

| # | Action | Expected result |
|---|---|---|
| 18 | *(C)* Six wrong admin passwords | Five `401`s then `429` from the durable throttle (MTP-02 step 15) |
| 19 | Four portal code requests for one contact inside ten minutes | The fourth is throttled (MTP-10 step 5) |
| 20 | *(C)* Drive one public API bucket past its window — 300 requests per five minutes per client address | `429` in the documented envelope, and the limit is per bucket and per address rather than global |
| 21 | Confirm each throttle returns the documented error envelope | A rate limit that returns a raw platform error, or a `500`, is a finding: it is the response an integrator sees most often |

### §5 What to record

One row per probe: the route, the identity, the id you supplied, the status, and the error code.
A pass is boring on purpose. Anything that returns a `200`, a `500`, a stack trace, or an error
that distinguishes "no such row" from "not yours" is written up with the request id.

### Exit criteria

§1 in full with the inventory attached, plus steps 7, 11, 13 and 17. Every finding here is at
least S1 — there is no cosmetic tier for a boundary.

---

## Appendix A — Coverage and weighting

| Plan | Part | Surfaces | Weight |
|---|---|---|---|
| MTP-01 | III | bring-up, seed, health, empty states | light |
| MTP-02 | III | auth, sessions, throttle | light |
| **MTP-03** | **I** | **forms builder, rules, publication, invited intake** | **heavy** |
| **MTP-04** | **I** | **public wizard, drafts, limits, deadline, edit/withdraw** | **heavy** |
| **MTP-05** | **I** | **rounds, assignment, blind review, scoring** | **heavy** |
| **MTP-06** | **I** | **49-pair matrix, queues, bulk, notification** | **heavy** |
| **MTP-07** | **I** | **promotion, placement, conflicts, publication** | **heavy** |
| **MTP-08** | **II** | **every surface — control/state/consistency** | **heavy** |
| **MTP-09** | **II** | **six timed tasks, first run, seams** | **medium** |
| MTP-10 | III | portal, uploads, tasks, impersonation | medium |
| MTP-11 | III | public pages, embeds, calendar, API | medium |
| MTP-12 | III | templates, reminders, webhooks, delivery | medium |
| MTP-13 | III | orgs, team, GDPR, billing, CRM | medium |
| MTP-14 | IV | tasks, deliverables, versions, ZIP export, file access | medium |
| MTP-15 | IV | roster identity, workflow vs confirmation, logistics, unavailability | medium |
| MTP-16 | IV | event creation, dates/timezone, vocabularies, API keys | medium |
| **MTP-17** | **IV** | **cross-tenant probing, tokens, throttles — every boundary at once** | **heavy** |

## Appendix B — Automated counterparts

Thirteen Playwright specs in [`../e2e/`](../e2e) overlap these plans: `admin-setup` (MTP-01/02),
`cfp-submit` (MTP-03/04), `abstracts-decide` (MTP-06), `review-operations` (MTP-05), `portal-tasks`
(MTP-10), `agenda-schedule` (MTP-07), `public-embeds` + `public-widgets-parity` (MTP-11),
`speaker-content-ops` (MTP-10/12/13/14/15), `self-service-onboarding` (MTP-13/13a), and three that
automate part of the design bar — `rendered-ui-polish`, `responsive-action-groups` and
`typography-hierarchy` (MTP-08). They run against a deployed target plus the `sb-test` Neon branch —
set `E2E_BASE_URL`, `NEON_TEST_URL`, `E2E_ADMIN_PASSWORD` and `E2E_REVIEWER_PASSWORD`, then
`pnpm e2e`.

Run the specs first. These plans exist for what specs cannot do: real inboxes, real calendar clients,
keyboard and screen-reader passes, cross-tenant probing by hand, timed usability with a human
operator, and the judgement a rubric can guide but not replace — "is this empty state deliberate?",
"does this dropdown belong to this product?"

Part IV is the least automated of the four. `speaker-content-ops` covers a happy path through the
roster, the version and comment threads, filtered reminders and a grouped ZIP export — so MTP-14 and
MTP-15 should be run for what it does not touch: real R2 under CORS, an export whose selection is
raced by a fresh upload, expiry, and the design bar on those surfaces. **MTP-16 and MTP-17 have no
automated counterpart at all.** Nothing in `e2e/` deletes a room out from under a published session
or probes one tenant's ids with another tenant's session, and both are exactly the kind of failure
that is silent until it is public.

## Appendix C — The capstone: one conference, end to end, in one sitting

Run this before any release you would show a customer. One operator, ~115 minutes, **starting from
`empty-conf` or a brand-new event** so nothing seeded carries you. No shortcuts through the API, no
direct database writes, and the stopwatch runs the whole way.

1. Create the event: dates, timezone, tracks, rooms, formats. *(≤ 10 min)*
2. Author and publish a CFP with one conditional question and one routing rule. *(≤ 15 min)*
3. Submit **four** proposals as four different speakers, from a private window — one on a phone
   viewport, one abandoned mid-way and resumed the next "day". *(≤ 20 min)*
4. Add one invited keynote that never went through the CFP. *(budget ≤ 4 min — this is where the run
   currently breaks; record the real figure)*
5. Run a review round: two reviewers, blind, both score everything. *(≤ 15 min)*
6. Accept two, decline two, notify both groups. Verify exactly four emails and zero duplicates.
   *(≤ 10 min)*
7. Promote the accepted talks, place all five sessions including the keynote, resolve the one
   conflict you deliberately create. *(≤ 10 min)*
8. Publish the schedule; open the public page and one embed in a fresh browser. *(≤ 5 min)*
9. Move one published session; confirm the public page and the calendar feed both follow and the
   change notification goes out. *(≤ 5 min)*
10. Assign a slide-upload task to your speakers, upload as two of them, chase the third, and export
    the deliverables you have as one ZIP. *(≤ 15 min)*
11. Open **Ready to announce**, copy the agenda link and one speaker's share card, and open both
    signed out. *(≤ 5 min)*
12. One speaker pulls out: take them off the public site without deleting their record, and confirm
    the schedule, the gallery and the calendar all agree afterwards. *(≤ 5 min)*

**Record:** total elapsed time, every point where you had to leave a surface to satisfy a
prerequisite, every screen you had to be told about, and every D-check miss along the way. The
capstone's output is one number — minutes to a published conference — and a list of the moments the
product got in the way. Both belong in the release notes.
