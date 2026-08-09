# The flows that matter: common user journeys and the ease bar for each

**Companion to:** [`product-readiness.md`](product-readiness.md) and
[`../plan/product-roadmap.md`](../plan/product-roadmap.md) · **Date:** Aug 9, 2026

This document names the journeys real users repeat, in frequency order per persona, so that
design and wiring effort lands on the paths people actually walk. Each flow gets: the steps as
the user experiences them, its current state (grounded in the readiness audit), the friction
that breaks "easy," and an **ease bar** — a concrete, testable statement of what "super easy"
means for that flow. The six Playwright specs should converge on these flows; when a flow's
modules land, its spec is the regression guard for the ease bar.

Two frequency classes matter. **Daily loops** are walked dozens of times per day during a CFP
window — every extra click multiplies. **One-time setups** are walked once per event — they can
be longer, but they must never dead-end, because a stuck setup is a lost customer.

---

## Persona 1 — Organizer (the buyer; lives in the app for weeks)

### Flow O1 · Triage new submissions *(daily loop — the highest-frequency flow in the product)*

**Steps:** open `/events/<id>/abstracts` → see what's new since yesterday → open a submission →
read every answer → tag/route it → move on to the next without going back to the list.

**Current state:** the table reads the database with real filters and status counts, but there
are **no row links, no detail drawer, no pagination controls, and no next/previous** — a
submission can be listed but not opened. `getSubmissionDetail` exists server-side with no
consuming UI.

**Friction to fix:** the drawer (status §6's named next action), keyboard next/prev inside the
drawer, a "new since last visit" cue, sticky filters.

**Ease bar:** from the table, an organizer reads a full submission in **one click**, moves to
the next in **one keystroke**, and never loses their filter/scroll position. Triage of 50 new
submissions is a single uninterrupted pass.

### Flow O2 · Decide and notify *(daily loop during decision windows — the product's core action)*

**Steps:** from a submission (or a multi-select of them) → Accept / Decline / Waitlist → review
what email will go out → Notify → see confirmation that exactly one email per speaker was sent
and logged.

**Current state:** **missing end-to-end.** No status-change mutation or `notifyDecisions`
exists; the transition guard and outbox are built and waiting. This is the top item in both the
ledger's next actions and roadmap P1.

**Friction to fix:** build it drawer-first (decide where you read), with bulk actions from the
table; make the notify step show the rendered email before sending; surface "notified ✓" state
on the row so nobody double-notifies (the idempotency keys already guarantee it server-side —
the UI must *show* it).

**Ease bar:** accept-and-notify a single submission in **≤3 clicks from the table row**, with
the sent email visible in the comms log **without leaving the page**. A batch of 20 accepts is
one multi-select and one confirm.

### Flow O3 · Chase speaker readiness *(daily loop between acceptance and the event)*

**Steps:** open the dashboard → Speaker Tracking shows who's missing bio/headshot/tasks and
who's overdue → click a name → land on that speaker with their gaps highlighted → send a
reminder or impersonate to unblock them.

**Current state:** the dashboard is real (server aggregation, 30 s polling) — the best-wired
admin surface. But its attention links land on **demo-only pages** (speakers admin, tasks
admin), reminders are a stub job, and impersonation has server support with no UI entry.

**Friction to fix:** wire the speakers admin list (M27) so dashboard links resolve; a
per-speaker "send reminder now" button; an impersonation entry with a visible "viewing as"
banner.

**Ease bar:** from "the number went up" on the dashboard to "reminder sent to the right person"
in **≤3 clicks**. The count visibly drops when the speaker completes the task (already polling —
this is the demo's money shot; keep it).

### Flow O4 · Create and open a CFP *(one-time setup — the first thing a new customer does)*

**Steps:** create event → brand it → set tracks/rooms/formats/tags → build the form (fields,
one visibility rule, one routing rule) → set deadline and per-user limit → preview as a speaker
→ publish → copy the public link.

**Current state:** **the front door is missing.** Event creation is a disabled button; the form
builder writes only to the browser demo store; forms exist only via seed. Everything downstream
(snapshot compiler, versioning, the public wizard) is real.

**Friction to fix:** event creation (roadmap M45 / M11 completion), builder persistence, an
always-visible "preview as speaker" that renders the *compiled snapshot* (the same thing
speakers will see), and a prominent copy-link + QR on publish.

**Ease bar:** a new organizer goes from blank account to a shareable CFP link in **under 15
minutes** without documentation. The preview is one click away at every step of the builder.

### Flow O5 · Schedule accepted talks *(concentrated burst after decisions)*

**Steps:** open Agenda → see accepted-but-unscheduled sessions in a tray → place one into a
room/time → conflicts surface immediately (double-booked room or speaker) → resolve → publish →
verify the public schedule updated.

**Current state:** agenda UI is demo-only with hardcoded rooms; the pure conflict engine is
real and tested; session CRUD/`moveSession` don't exist. Click-to-place is the accepted
fallback; drag-and-drop is roadmap margin.

**Ease bar:** placing a session is **one click on the tray item + one click on a slot**, a
conflict is visible **at placement time** (not on a later validation pass), and "publish" states
exactly what becomes public. Manual placement done well beats DnD done late.

### Flow O6 · Trust the comms *(recurring, anxiety-driven)*

**Steps:** "did the acceptance email actually reach her?" → open Communications → find the
recipient → see status (sent/delivered/failed), timestamps, and the rendered body → resend if
needed.

**Current state:** the dispatcher/log engine is the best code in the repo; the comms admin UI is
demo-only with hardcoded templates — `listLog` has no consumer.

**Ease bar:** answer "did she get it?" in **≤2 clicks from anywhere** (search by name/email),
with failed sends impossible to miss (badge on the nav item). Template editing shows a rendered
preview with sample data before save.

---

## Persona 2 — Reviewer (bursty; a few sessions during the review window)

### Flow R1 · Score my queue

**Steps:** open review link → sign in → see *my* assigned submissions with my progress ("12 of
40") → open one → read all answers → score 1–5 + comment → auto-advance to the next unscored →
finish the queue.

**Current state:** demo-only page with a hardcoded reviewer name and fake progress; the
evaluation schema (plans, assignments, reviews) exists unused; no server module at all.

**Friction to fix:** the whole M19 server slice; then design the queue as a **conveyor** —
score, auto-advance, progress bar — not a table the reviewer must navigate.

**Ease bar:** a reviewer with 40 assignments finishes in one sitting without touching the URL
bar or the back button; each score is **one click + optional comment + auto-advance**. Reviewers
are volunteers — any friction here costs the organizer chased-down favors.

---

## Persona 3 — Speaker (occasional; must work first-try, on a phone)

### Flow S1 · Submit a talk *(the highest-stakes flow — every speaker's first impression)*

**Steps:** tap the CFP link from a phone → see the branded welcome → enter email → type the OTP
from their inbox → answer the wizard steps → review → submit → see the confirmation with the
SESS code → get the confirmation email.

**Current state:** **real and proven deployed end-to-end** (ledger rev. 7), including delivered
email. Remaining friction: **no file-upload wiring** in the real wizard (the R2 routes have no
UI caller), **no draft resume** surfaced, no client-side required-field validation before the
server round-trip, co-speaker collection unbuilt, and the success page is still the demo
component with a placeholder code fallback.

**Ease bar:** a first-time speaker submits from a phone in **under 5 minutes**; validation
errors appear on the field before submit, not as a server error after; closing the tab mid-way
and returning resumes the draft (the server draft already exists — show it); the success page
shows *their* real SESS code and what happens next.

### Flow S2 · Get accepted and get ready *(the retention flow — one email must carry it)*

**Steps:** acceptance email arrives → tap the portal link → land signed-in (or one OTP) → home
shows exactly what's needed: complete profile (bio + headshot), outstanding tasks with due
dates → do them one by one → watch the checklist clear → see "My Sessions" with time/room →
add to calendar.

**Current state:** split. Portal auth, home, submissions list/detail are real. Profile, tasks,
and resources pages are demo-only; task completion (`completeTaskVia*`) and profile writes have
no runtime; headshot upload has no UI; the decision email itself can't be sent yet (O2). ICS
routes are real and waiting.

**Friction to fix:** the M22/M25 runtimes, upload widget onto the finished R2 routes, and a
portal home that is a **single ordered checklist** — not a dashboard of widgets — until
everything is done.

**Ease bar:** from acceptance email to completed profile + first task in **≤10 minutes on a
phone**. The portal never shows a task without a working "do it now" path. Add-to-calendar is
one tap and imports cleanly into Google and Outlook.

### Flow S3 · Come back later

**Steps:** speaker returns weeks later → enters email → OTP or magic link → lands exactly where
their outstanding work is.

**Current state:** auth is real and durable (30-day sessions). The gap is what they land on
(S2's demo pages).

**Ease bar:** returning takes **one OTP maximum** (durable session preferred), and the landing
view leads with outstanding items, not a generic home.

### Flow S4 · Edit my submission before the deadline

**Current state:** cut (M41) — portal detail is read-only. Flagged in the roadmap as buyer
table stakes: speakers *will* email organizers asking to fix a typo, which turns a self-serve
flow into organizer support load.

**Ease bar (when built):** "Edit" is visible on the submission until the form closes, reuses
the same wizard, and shows "updated" state to both sides.

---

## Persona 4 — Attendee / public visitor (highest volume, zero patience)

### Flow P1 · Check the schedule

**Steps:** open the conference site → the embedded schedule renders → filter by day/track → tap
a session → see abstract + speakers → add to calendar. Repeat on the gallery for speakers.

**Current state:** the pages exist, are edge-cached, and embed correctly (proven at rev. 7) —
but they **render demo-store fixtures, not the database** (`useDemo()` client components with
hardcoded day tabs). The public API reads real `published_*` views, so the data path exists;
the pages don't use it.

**Friction to fix:** M32's rewrite onto the published views, server-rendered (the caching
already works); day tabs derived from real event dates; per-session deep links so sessions are
shareable.

**Ease bar:** loads fast on conference wifi (server-rendered + cached — no client store
hydration), every session and speaker has a shareable URL, and add-to-calendar works from the
page in one tap. What renders is **only** published data — that boundary is already enforced in
the views; keep it.

---

## Cross-cutting design rules (what "intuitively designed" means here)

1. **The daily loops get the keyboard; the one-time setups get the wizard.** O1/O2/R1 deserve
   next/prev keys and bulk actions; O4 deserves guided steps and a preview. Don't invert this.
2. **Every dashboard number is a door.** If a metric can't be clicked through to the exact list
   of people/items behind it — and from there to the fix — it teaches users the dashboard is
   decorative. (The polling dashboard is already built; the doors are what's missing.)
3. **Show system state the backend already guarantees.** Idempotent sends, notify state,
   draft existence, task completion — all enforced server-side today, none visible in UI. Trust
   comes from *seeing* "already sent ✓", not from it silently being true.
4. **Speaker surfaces are phone-first; organizer surfaces are density-first.** The two audiences
   never share a layout constraint. Test S1/S2 at 375 px as the default, not as a check.
5. **No dead ends.** Every empty state names the next action ("No submissions yet — share your
   CFP link"), every error names the recovery, and no page links to a surface that isn't wired
   (the current dashboard → demo-page links violate this; fix as those surfaces land).
6. **One mental model for forms everywhere.** CFP wizard, portal tasks, and profile all render
   through the same snapshot renderer — keep that, so a speaker who has seen one form has seen
   them all.
7. **Wire the ease bars into the six e2e specs.** Each flow above maps onto the existing spec
   skeleton; as modules land, encode the click/keystroke budgets as assertions where practical
   (e.g., drawer opens from row click, auto-advance after scoring) so "easy" is regression-tested,
   not re-argued.

## Priority read

Ordered by (frequency × current breakage): **O2 decide/notify** (core action, missing) →
**O1 drawer** (highest frequency, one click short) → **S2 portal runtimes + upload** (retention,
half-built) → **P1 public pages on real data** (highest volume, wrong data source) → **R1
reviewer conveyor** (window-critical, absent) → **O4 event/form creation** (first-run, blocks
new customers) → **O3 chase loop doors** → **O5 scheduling** → **O6 comms visibility** →
**S4 edit-until-close**. This ordering is the same work as roadmap P1 — it just names the user
experience each module must land, not only the module.
