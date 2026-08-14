# Openboard manual test plans

Thirteen manual test plans. They are weighted deliberately: **the core flow — solicit speakers,
accept or reject their talks, schedule the conference — gets five of the thirteen (MTP-03…MTP-07)
and roughly half the document**, because that is the loop the product lives or dies on. Two more
(MTP-08, MTP-09) exist to hold a **design bar**: a screen that works but looks or feels wrong fails
these plans, and "it functions" is not a defence.

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

**File uploads** presign against real R2. Either fill `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME=sb-files-dev`, or run those steps on Env C. CORS is only
genuinely exercised on a deployed origin.

**Set your workstation clock to a timezone that is not `America/Los_Angeles`** for the whole of
MTP-03…MTP-07. The seeded event is in Pacific; a tester in Pacific cannot detect a timezone bug.

### 0.3 Draining the outbox locally

Outbound email never sends inline: a domain event enqueues an outbox row, and the cron-driven
dispatcher is the only caller of Resend. Advance it by hand:

```bash
curl -s -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/jobs/outbox | jq .
# same shape for /api/jobs/reminders and /api/jobs/cleanup
```

Or run the real dispatcher on its minute schedule in a second terminal: `pnpm dev:jobs`.

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

- Organizer: `/events`, `/events/<eventId>/{dashboard,forms,abstracts,evaluation,agenda,speakers,tasks,files,communications,resources,embeds,settings}`
- Reviewer: `/events/<eventId>/review` only — the nav hides everything else
- Speaker: `/portal/<eventSlug>/…`
- Public: `/e/<eventSlug>/…`, `/embed/<eventSlug>/…`, `/submit/…`, `/api/v1/…`
- Organization: `/organizations`, `/organizations/<orgId>/{team,audit,billing,onboarding,crm}`

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
speaker. Both paths preserve the shared `SESS-n` sequence and manual creation sends no CFP receipt.
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

**Environments:** A · **Duration:** ~75 min · **Precondition:** MTP-01, signed in as organizer, clock
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
| 11 | Add a routing rule: Format = Workshop → track *AI Agents* + tag *Tooling* | Saves; appears in the rules list |
| 12 | Add a second, conflicting rule and reorder the two | Precedence is explicit in the UI — the user can tell which wins without guessing (D6) |
| 13 | Duplicate the form | A copy with its own id and no submissions; the original is untouched |
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
| 27 | Confirm the manual abstract got a real `SESS-n` from the same sequence as CFP submissions | Codes are unique and gapless across both intake paths — no collision, no duplicate |
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

**Environments:** A, with §1 repeated on C · **Duration:** ~75 min · **Precondition:** MTP-03.

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
| 8 | **Submission B (the routing case).** Start a second proposal. Set *Format* = **Workshop**, answer the Workshop duration follow-up, set *Track* = **Platforms**, complete Title, Description, First/Last, Email, and submit **with Workshop still selected** | Success page with the next `SESS-n` code |
| 9 | Check Submission B as organizer | Track reads **AI Agents**, tag **Tooling** — the routing rule overrode the speaker's *Platforms* answer |
| 10 | Open both submissions' answers | B has every answer including the conditional. A has no orphaned Workshop-duration answer — absent, not blank |
| 11 | *(Env C)* Repeat steps 1–8 with a real inbox | The OTP email arrives from the verified domain and the code works. There is no fixed-code shortcut in any environment; on Env A the same real code is surfaced in the login UI by `EMAIL_FALLBACK_UI=1` |

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
| 35 | List every `SESS-n` code issued in this plan | Unique, sequential, no gaps, no reuse — including the manual abstract from MTP-03 §2 |
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

**Environments:** A · **Duration:** ~60 min · **Precondition:** MTP-04, so real submissions exist.
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

Steps 12, 19, 22 are the load-bearing three: blindness, arithmetic, snapshot pinning.

---

## MTP-06 — Decide: accept, reject, and tell the speakers

**Environments:** A, with §4 repeated on C · **Duration:** ~75 min · **Precondition:** MTP-05.

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
(`src/features/submissions/server/mutations.ts:548`) calls `assertTransition` for every source status
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
| 30 | Confirm no declined or withdrawn submission appears on any public surface | Absent from all six public pages and both APIs |

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

**Environments:** A, with §6 on C · **Duration:** ~90 min · **Precondition:** MTP-06, so accepted
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
| 30 | Publish one session; open `/e/ai-engineer-sandbox-event/schedule` | It appears publicly |
| 31 | Leave another unpublished; search for it publicly and in `/api/v1/events/<slug>/schedule` | Absent from both |
| 32 | Bulk-publish the rest | All appear on the next load; the action reports how many |
| 33 | Unpublish a published session | It disappears publicly. Any speaker-facing consequence is visible to the organizer first |
| 34 | Move a **published** session | The public schedule reflects the move, and a **Schedule changed** message is enqueued — not a duplicate invite |
| 35 | Delete a published session | Gone publicly; calendar consumers see a cancellation, not a silent gap |
| 36 | Check the public page's day tabs with your clock outside Pacific | Sessions bin onto the correct **event-local** day. A session at 9 pm Pacific must not appear on the next day |
| 37 | Publish the whole schedule and compare against Abstracts | Every accepted talk is either scheduled or knowingly unscheduled; nothing accepted has silently vanished |

### §6 On the deployed preview

| # | Action | Expected result |
|---|---|---|
| 38 | Repeat steps 9, 16–19, 25–28 on Env C | Same behavior. Drag-and-drop in particular has no deployed pass on record |
| 39 | After publishing, request the public schedule until regeneration settles | A fresh response has `s-maxage`, or a cached response reports `x-nextjs-cache: HIT`; `STALE` alone is not a pass, its `data-openboard-deployment` marker matches `/api/health`, and the newly published session is in the payload |

### §7 Design checks

Walk §0.7 on the agenda grid, the session dialog, the conflict indicator, the auto-place preview, and
every view (list/day/week/track/room). Specifically:

- **D1** on the session dialog's shared selects (DD-1 regression) and **D9** on its zoned placement inputs (DD-2 regression)
- **D3** on drag-and-drop — **is there a keyboard path to move a session?** If not, that is S1 for
  accessibility, and it is the kind of thing a mouse-only tester never notices
- **D7** on the grid at 390 px and at 1920 px with 5 rooms and a full day
- **D8** on the conflict indicator — if color is its only signal, it fails
- **D10** on the new-session dialog's inline speaker-create path (DD-3 regression)

### Exit criteria

§1 (idempotent promotion), §3 in full (every conflict dimension plus adjacency), §5 steps 31 and 36
(nothing unpublished leaks; timezone binning). Zero new S1/S2.

---

# Part II — The design bar

MTP-08 and MTP-09 are the plans that fail a product for being unfinished rather than broken. Run
MTP-08 on Env A against a freshly seeded database (it used to run on the retired browser demo);
run MTP-09 wherever the operator can be given a real task.

---

## MTP-08 — Control, state, and consistency sweep

**Environments:** A (seeded), C to confirm anything suspicious · **Duration:** ~120 min ·
**Cadence:** every release, and after any change to `globals.css` or `ui-kit.tsx`.

**Objective.** Inventory every interactive control on every surface and hold each to §0.7. This is
the plan that catches unstyled dropdowns, mismatched date pickers, missing focus rings, and empty
states nobody designed.

### §1 The inventory

Fill one row per (surface, control type). 24 surfaces × the controls each carries.

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
| Speakers list + detail | table, filters, invite | | | | | |
| Speaker roster panels | datetime, selects | | | | | |
| Tasks admin + task editor | date input, selects | | | | | |
| Files admin | selects, upload | | | | | |
| Communications (6 tabs) | tabs, editor, selects | | | | | |
| Resources admin | table, editor | | | | | |
| Embeds | config, color input | | | | | |
| Event settings | tabs, selects, inputs | | | | | |
| Dashboard | select, cards, queue | | | | | |
| Portal (home/tasks/profile/submissions) | uploads, forms | | | | | |
| Public pages (×6) + embeds | filters, search, star | | | | | |
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

**Environments:** A · **Duration:** ~90 min for six tasks · **Operator:** someone who has **not**
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

### Exit criteria

Every task is inside budget. Task 1 is the headline DD-3 regression check.

---

# Part III — Supporting surfaces

Regression plans for everything outside the core flow. §0.7's design bar still applies; the release
threshold outside the core flow is zero S1.

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
| 10 | `curl -s localhost:3000/api/health \| jq .` | Real DB round-trip: status, Postgres version, latency, build sha |
| 11 | Sign in as organizer | Lands on an event surface with the four nav groups |
| 12 | Open the seeded Dashboard | Non-empty: counts, attention queue, the five incomplete speakers |
| 13 | Open **Empty Conf** and click every nav item | A deliberate empty state everywhere. No crash, no `NaN`, no endless spinner. **Record D5 on each** |
| 14 | `pnpm typecheck && pnpm lint && pnpm invariants && pnpm test` | All green; record the vitest count |
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
| 15 | *(C)* Six paced wrong-password attempts | Five `401`s then `429 RATE_LIMITED` |
| 16 | *(Optional, needs Google credentials)* Google sign-in | Round-trips through `/api/auth/callback/google` |
| 17 | `POST /api/test/login` | `404`; the retired session-minting backdoor does not exist |

**Design checks.** §0.7 on `/login`, `/login/forgot`, `/login/reset`, `/account/sessions`. D4 matters
most here: an auth error that is vague is a support ticket.

**Known gaps.** Unpaced attempts on Env C hit Cloudflare 1102/503 before the app throttle answers —
pace step 15 (~1 s) or the result is inconclusive.

---

## MTP-10 — Speaker portal

**Environments:** A, **C for uploads** · **Duration:** ~50 min

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

**Design checks.** §0.7 on portal home, task list, task detail, profile, resources — this is the
surface a speaker sees, so S3s here cost more than elsewhere.

**Known gaps.** Step 12 has a recorded defect (M52) in the portal upload's `attach()` POST: the file
may land in R2 without the task flipping. Confirm before re-filing.

---

## MTP-11 — Public surfaces, embeds, calendar, and the public API

**Environments:** A for content, **C for headers** · **Duration:** ~50 min · **Precondition:** MTP-07.

| # | Action | Expected result |
|---|---|---|
| 1 | Visit `/e/<slug>/{sessions,agenda,schedule,itinerary,speakers,gallery}` | Each renders published content |
| 2 | On sessions: search + Track/Format/Location filters | Each narrows the same grid; they compose |
| 3 | On agenda: navigate days, open and close a detail | The active day survives |
| 4 | On speakers: search a surname | One row with bio and sessions; surname sort |
| 5 | On gallery: find a speaker with no headshot | Initials fallback, not a broken image |
| 6 | On itinerary: star two, reload, unstar one, export ICS | Two after reload; the export has only the remainder |
| 7 | Import that ICS into a calendar client | Correct times for the event zone, with title, room, description |
| 8 | Compare one session and one speaker across all six surfaces and the admin | Everything agrees |
| 9 | Search for the draft session and a declined speaker on every public page, every embed, and both APIs | Absent everywhere |
| 10 | Open a portal invite's `/cal/<token>` | A valid subscribable feed |
| 11 | Move a published session; refetch | Reflected; a deletion appears as a cancellation |
| 12 | `/cal/not-a-real-token` | Rejected — feeds are token-authorized |
| 13 | Change an embed style/filter; save; reload the embed | Takes effect on next load |
| 14 | Toggle the embed kill switch | Stops serving content |
| 15 | Frame an embed cross-origin | Renders; no `X-Frame-Options` |
| 16 | *(C)* Request a public page and an embed until regeneration settles | A fresh response has `s-maxage`, or a cached response reports `x-nextjs-cache: HIT`; `STALE` alone is not a pass, and each body marker matches `/api/health`'s unique deployment id |
| 17 | Unauthenticated `/api/v1/events/<slug>`, `/schedule`, `/speakers` | `200`, published rows only |
| 18 | `Authorization: Bearer nope` on `/stats` | `401` in the documented envelope — **before** any 404 for a bad slug |
| 19 | Valid key on `/stats` | `200`; agrees with the dashboard |
| 20 | `/submissions?limit=1` then follow `meta.nextCursor` | Pages cleanly; no drafts; no repeats |
| 21 | Revoke the key; repeat 19 | `401` immediately |
| 22 | Event A's key against event B | `401`/`404` — keys are per-event |
| 23 | All six surfaces for **Empty Conf** | Deliberate empty states |
| 24 | All six at 390 px | Usable; no horizontal scroll |

**Design checks.** §0.7 on all six public surfaces and their embeds. These are the pages an attendee
sees; D7 and D8 failures here are public.

---

## MTP-12 — Communications, reminders, and delivery compliance

**Environments:** A, **C for delivery** · **Duration:** ~50 min

| # | Action | Expected result |
|---|---|---|
| 1 | **Communications → Delivery log** | The seeded log: recipient, subject, template, status, time |
| 2 | Search by recipient and subject | Narrows; clearing restores |
| 3 | Open one entry | Full detail including rendered body and delivery state |
| 4 | **Templates** — confirm all 12 event-editable templates (the two admin-auth templates are not event-editable) | Each with a description of its trigger |
| 5 | Edit a body with `<script>` plus a legitimate `<a href>`; save | Script stripped, link kept; the UI confirms sanitization |
| 6 | **Preview** | Renders with sample data — no raw `{{tokens}}` |
| 7 | **Bulk send** to a segment | One row per resolved recipient; the shown count matches |
| 8 | Suppress one recipient; send again | Skipped, with the reason recorded — not counted as sent |
| 9 | Inspect a delivered message | `List-Unsubscribe` present |
| 10 | Follow unsubscribe and confirm | Suppressed; later sends skip it |
| 11 | Enable a reminder ladder with an overdue offset | Saved; shows Active |
| 12 | Pause it | Shows Paused; the next scan enqueues nothing for it |
| 13 | Re-activate; `POST /api/jobs/reminders` | Reminders for overdue items only |
| 14 | Run it again immediately | No duplicates in the same window |
| 15 | `POST /api/jobs/outbox` with a wrong secret | `401` |
| 16 | Drain and read the log | Each message rendered once, with template and idempotency key |
| 17 | Publish a session; drain | A **Schedule assigned** message ("You're scheduled: …") with ICS and Google/Outlook deeplinks |
| 18 | Move it; drain | **Schedule changed** replaying the update — not a duplicate invite |
| 19 | Signed bounce payload to `/api/webhooks/resend` | Accepted; recipient marked bounced and suppressed |
| 20 | Same payload, bad signature | Rejected |
| 21 | Complaint payload | Recorded and suppressed |
| 22 | Deliverability panel | Reflects 19–21 |
| 23 | *(C, `EMAIL_MODE=send`)* Send to an allowlisted inbox | Delivered from the verified domain; `dmarc=pass`, SPF/DKIM aligned |

**Known gaps.** The Outlook delivery probe has never been run — a step 23 failure against Outlook is
new territory, not a regression. Production forbids `EMAIL_FALLBACK_UI=1`; a credential appearing in
a production-mode render is a P0.

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

## Appendix B — Automated counterparts

Ten Playwright specs in [`../e2e/`](../e2e) overlap these plans: `admin-setup` (MTP-01/02),
`cfp-submit` (MTP-03/04), `abstracts-decide` (MTP-06), `review-operations` (MTP-05), `portal-tasks`
(MTP-10), `agenda-schedule` (MTP-07), `public-embeds` + `public-widgets-parity` (MTP-11),
`speaker-content-ops` (MTP-10/12/13), `self-service-onboarding` (MTP-13/13a). They run against a
deployed target plus the `sb-test` Neon branch — set `E2E_BASE_URL` and `NEON_TEST_URL`, then
`pnpm e2e`.

Run the specs first. These plans exist for what specs cannot do: real inboxes, real calendar clients,
keyboard and screen-reader passes, cross-tenant probing by hand, timed usability with a human
operator, and the judgement a rubric can guide but not replace — "is this empty state deliberate?",
"does this dropdown belong to this product?"

## Appendix C — The capstone: one conference, end to end, in one sitting

Run this before any release you would show a customer. One operator, ~90 minutes, **starting from
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

**Record:** total elapsed time, every point where you had to leave a surface to satisfy a
prerequisite, every screen you had to be told about, and every D-check miss along the way. The
capstone's output is one number — minutes to a published conference — and a list of the moments the
product got in the way. Both belong in the release notes.
