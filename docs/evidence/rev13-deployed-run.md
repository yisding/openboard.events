# Rev. 13 deployed demonstration run

Everything below was executed on **Mon Aug 10, 2026, 21:22–22:10 UTC** against the live preview
`https://sb-web-preview.yi-ding.workers.dev` (deployed version `3f42f894`, code = merge `7b9cf3a`;
`/api/health` reports `sha: 8b566c0`, the migration-batch fix on top of it) and the Neon `sb-test`
branch (`ep-gentle-field-a6h1ardx`, direct URL). Nothing here is a test double: every status code,
row and header is from that deployment and that database.

**Nothing was deployed by this run.** The preview was not rebuilt, no secret or var was changed,
and no migration was applied. The only writes were to `sb-test` (the suite's own wipe + reseed,
`pnpm admin:bootstrap`, and the demonstrations below) and, in the working tree, to `e2e/**`,
`DECISIONS.md` and this file.

Environment for every command in this document:

```bash
set -a; . .dev.vars; set +a
export NEON_TEST_URL="$(neon connection-string sb-test --project-id ancient-truth-16438557)"
export E2E_BASE_URL=https://sb-web-preview.yi-ding.workers.dev
```

Seeded ids come from `scripts/seed/lib/ids.ts`: event `aie-nyc` =
`9677e5d3-ccfc-5270-9b22-e551f8b4c57d`, slug `ai-engineer-sandbox-event`; the empty event is
`a4cae7eb-4079-5549-a52f-d9061c78b771`.

### Reproducibility: what is a transcript and what is not

**Read this before citing anything below as reproducible.** Added during the rev.-13 review pass,
which found that most sections recorded an *outcome* without the invocation that produced it —
against this document's own promise of "commands, UTC timestamps and raw outcomes" and against the
house standard set by [`m52-zip-cpu-measurement.md`](./m52-zip-cpu-measurement.md) §2 (harness path,
exact `wrangler` invocation, tool versions).

| Section | Invocation recorded | Raw output retained |
|---|---|---|
| §1a–§1f Playwright runs | **Yes** — the `pnpm exec playwright test …` lines are verbatim | Only the four failure artifacts in §1g; stdout was not captured to a file |
| §4 CSP/HSTS/`/f/{id}` | **Yes** — `curl -sSI` | Header blocks quoted verbatim |
| §1a template counts, §1c Chromium probe, §1f health probe, §2a Better Auth probes, §2b hash table + round trip, §3a/§3b throttle probes, §5 `communication_logs` read-back, §7 hand-computed average | **No — recipes only, added below** | **No.** The shells were ad-hoc and not scripted; nothing was teed to a file |

The recipes below are written **from the described probe, during the review pass** — they are not
transcripts of the original invocation, and they are labelled as recipes wherever they appear. Every
*outcome* in this document is from the original run; what is reconstructed is only the command
shape. A rerun will produce different ids, timings and (for §3) different bucket state.

```bash
# Common prelude for every recipe below.
set -a; . .dev.vars; set +a
export NEON_TEST_URL="$(neon connection-string sb-test --project-id ancient-truth-16438557)"
export BASE=https://sb-web-preview.yi-ding.workers.dev
q() { psql "$NEON_TEST_URL" -At -F' | ' -c "$1"; }   # every SQL recipe goes through this
```

- **§1a template counts** —
  `q "SELECT e.slug, count(t.*) FROM events e LEFT JOIN email_templates t ON t.event_id=e.id GROUP BY e.slug ORDER BY e.slug"`
- **§1c Chromium probe (failure 6)** — a standalone Playwright script, not part of the suite:
  `page.on("requestfailed", …); page.on("console", …); await page.setContent('<iframe src="'"$BASE"'/embed/ai-engineer-sandbox-event/sessions"></iframe>')`
  over a `data:` document, which is what produced the `ERR_BLOCKED_BY_RESPONSE` /
  `frame-ancestors *` pair quoted there.
- **§1f bare health probe** — `for i in 1 2 3; do curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/health"; done`
- **§2a Better Auth probes** — `for p in get-session sign-in/email callback/google sign-in/social; do curl -s -o /dev/null -w "GET  /api/auth/$p %{http_code}\n" "$BASE/api/auth/$p"; done`
  plus `curl -s -w '\n%{http_code}\n' -X POST -H 'content-type: application/json' -d '{}' "$BASE/api/auth/sign-in/email"` (and `/social`).
- **§2b credential rows** —
  `q "SELECT u.email, left(u.password_hash,12), a.provider_id, left(a.password,12) FROM users u LEFT JOIN admin_accounts a ON a.user_id=u.id ORDER BY u.email"`
- **§2b round trip** — one `curl -c/-b` cookie jar across five calls, in this order: `POST /api/auth/sign-in` with a wrong password, the same with the real one, `GET /api/internal/submissions/<event>/counts` with the jar, the same with no jar, `POST /api/auth/sign-out`, then the counts call **replaying the saved pre-sign-out jar** (copy the jar file before signing out — that copy is the whole point of the probe).
- **§3a portal limiter** — 23 iterations of
  `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d "{\"eventSlug\":\"ai-engineer-sandbox-event\",\"email\":\"probe-$i-$RANDOM@example.com\"}" "$BASE/api/internal/auth/portal/request"`, tallied with `sort | uniq -c`.
- **§3b admin throttle** — six iterations of
  `curl -s -o /dev/null -w '%{http_code} %{time_total}\n' -X POST -H 'content-type: application/json' -d '{"eventId":"9677e5d3-…","email":"throwaway@example.com","password":"wrong"}' "$BASE/api/auth/sign-in"` with `sleep 1.5` between them. **The pacing is load-bearing** — Finding 2 is what an unpaced version does.
- **§5 read-back** — note that `communication_logs` has **no `recipient` column**
  (`drizzle/0000_init.sql:351-362`); §5's table shows the derived recipient, i.e. the joined
  `contacts.email`, which is the address the dispatcher actually sends to:
  `q "SELECT l.id,l.status,l.template_key,l.provider_message_id,l.error,l.sent_at,c.email FROM communication_logs l JOIN contacts c ON c.id=l.contact_id WHERE l.submission_id='7c109ae5-…' ORDER BY l.sent_at"`,
  and `q "SELECT status, notified_at FROM submissions WHERE id='7c109ae5-…'"` for the second half of
  that paragraph.
- **§7 hand-computed average** — the predicate is copied verbatim from `submission_ratings_v`
  (`drizzle/0001_views_triggers.sql:119`), which is the whole point of the comparison:
  `q "SELECT s.code, round(avg(r.overall_score)::numeric,3) AS rating, count(r.overall_score) AS n FROM reviews r JOIN submissions s ON s.id=r.submission_id WHERE r.plan_id='5e95d52f-…' AND r.overall_score IS NOT NULL AND r.submitted_at IS NOT NULL AND NOT r.is_ai GROUP BY s.code ORDER BY s.code"`

A follow-up run of any of these should tee its output into `docs/evidence/` rather than leave it in
a shell scrollback, which is the gap this table exists to stop repeating.

**What this run settles, in one paragraph.** The full Playwright suite runs against the deployment
and the five deployed-evidence gates are open (§1). Accept → notify → a **real Resend send** to the
allowlisted inbox, with exactly one log row and an idempotent second press, is done (§5). Reviewer
scoring agrees with the organizer's Rating column 3/3 (§7). Both deployed 429s are recorded — the
portal-login IP limiter and, closing a CP0/R1 item open since rev. 5, the admin sign-in throttle
(§3). CSP, HSTS and the embed's restored edge-cacheability are captured on the artifact itself
(§4). The browser R2 upload is green in the suite (§6). **The M42 S4 redo is not done and could not
be**: the preview runs `ADMIN_AUTH_PROVIDER=fallback` and holds no Google credentials, so the whole
Better Auth surface answers 404 — what this run could do instead was reproduce, deployed, the exact
revocation gap M42 exists to close (§2).

---

## 1. The full Playwright suite against the preview

### 1a. Run 1 — the suite exactly as merged

```
21:23:54Z  pnpm exec playwright test
21:27:02Z  1 failed · 17 skipped · 23 passed (3.1m)
```

Global setup ran `pnpm seed --wipe` against `sb-test` first and it **completed** (48.4 s, 72 tables
wiped, `organizations 1`) — the org-safe seed fix `9f91cb3` is what makes that possible; before it,
`events_organization_id_fkey` failed on the first insert after a wipe.

The 17 skips were the five `landed.ts` gates still at `false` (M50–M54) — deployed/data remainders,
not code gaps. The one failure:

| Spec | Failure | Verdict |
|---|---|---|
| `admin-setup.spec.ts:56` — "creating an event validates its dates and its slug" | `nav[aria-label='Template keys'] button` — expected 11, received 14 | **SPEC-BUG (fixed)** |

Triage: `TEMPLATE_KEYS` in `src/shared/contracts/enums.ts` has **14** entries — M42's `0009` added
`admin_password_reset` and `admin_email_verification`, M44's `0011` added `organization_invited` —
and migration `0014` backfills every event's missing rows, so an event created through M11 gets all
14. Confirmed against `sb-test`:

```
slug                        | templates       every key: 3 rows (one per non-empty event)
ai-engineer-sandbox-event   | 14
e2e-event-msnqpnf8-4mf      | 14
empty-conf                  |  0
```

The stale constant was `e2e/helpers/seeded.ts`'s `TEMPLATE_KEYS_PER_EVENT = 11`. Fixed spec-side
(constant → 14, with the self-check in the spec updated to match). The app was right.

*(Recorded, not fixed: the seeded `empty-conf` event has **0** `email_templates` rows. Any send for
that event would hit the dispatcher's terminal "missing template row" path. It is out of scope for
a spec fix — see Findings.)*

### 1b. Run 2 — with the five deployed-evidence gates flipped

The M50/M51/M52/M53/M54 entries in `e2e/helpers/landed.ts` were gated on conditions this run
satisfies (each gate's own comment stated the condition): the preview carries migrations
`0004`/`0006`/`0008` (and `0009`–`0014`), and `sb-test` is wiped and reseeded by the suite's own
global setup, which is what tops up Round 2 and the two blind-review questions. All five flipped —
17 skips became 3 (the "without a database" placeholders).

```
21:33:50Z  pnpm exec playwright test        (41 tests, workers: 1, retries: 1)
21:41:49Z  9 failed · 3 skipped · 29 passed (7.9m)
```

Passing on the deployed preview, among others: the CFP wizard end-to-end and at 390 px, the
LIMIT_REACHED block, the closed-form page, the abstracts tab counts, **bulk accept-and-notify with
exactly one `communication_logs` row per submission and a second Notify that writes none**, event
creation and validation, the builder's public-form link, conflict detection and the seeded
conflict/back-to-back pairs, all six agenda views, publish→public schedule, the portal profile
(bio limit enforced client *and* server), **a real browser R2 upload through presign → PUT →
finalize**, the same at 390 px, the public pages and their leakage rules, the embed variant's
framability, and the public API's published-only rows.

### 1c. Triage of all nine failures

| # | Spec | Failure | Root cause | Verdict |
|---|---|---|---|---|
| 1 | `agenda-schedule.spec.ts:241` (M54) | `getByRole("button", {name:/auto-place/i})` timed out | The spec opens `?view=list`; `agenda-page.tsx` renders `UnscheduledTray` (which owns Auto-place) only beside the **grid** views — the list view replaces the whole workspace | **SPEC-BUG (fixed** → `?view=day`**)** |
| 2 | `public-widgets-parity.spec.ts:152` (M53) | strict-mode violation: `getByText("Ada Lovelace")` → 2 nodes | The collapsed row carries the speaker byline *and* the expanded detail links her | **SPEC-BUG (fixed** → scoped to `.session-detail`**)** |
| 3 | `public-widgets-parity.spec.ts:208` (M53) | "each gallery card needs a headshot or an initials fallback" → 0 | `SpeakerAvatar` renders the fallback as `<span class="person-avatar …">JG</span>`; the spec looked for `.speaker-avatar-initials, [class*='initial']`, which exists nowhere | **SPEC-BUG (fixed** → `span.person-avatar`**)** |
| 4 | `public-widgets-parity.spec.ts:287` (M53) | `TypeError: Cannot read properties of undefined (reading 'find')` | The spec declared a `{ event, sessions: [...] }` shape with `{id,name}` vocabulary objects; `/api/v1/events/:slug/schedule` answers `{ data: [...], meta }` with vocabulary flattened to **names** and a contact's id spelled `id` | **SPEC-BUG (fixed** — types rewritten to the real DTO, parity now maps id→name through the organizer's own `/vocab/:kind`**)** |
| 5 | `public-widgets-parity.spec.ts:375` (M53) | `TypeError: … (reading 'map')` | Same fictional envelope | **SPEC-BUG (fixed)** |
| 6 | `public-widgets-parity.spec.ts:414` (M53) | five cross-origin iframes stayed empty | Two causes, both spec-side — see below | **SPEC-BUG (fixed)** |
| 7 | `review-operations.spec.ts:94` (M50) | `review_reminder` rows did not increase | Deployed route answers `{"enqueued":0,"skipped":3}`: **no seeded reviewer has a `contacts` row**, and `sendReviewRemindersIn` deliberately skips a reviewer with no contact ("a provisioning gap to report") | **APP/SEED GAP — not fixed** (see Findings) |
| 8 | `speaker-content-ops.spec.ts:51` (M51) | `.portal-uploads` never appeared (60 s) | The step allows the upload 60 s **inside a test whose whole budget is Playwright's 30 s default**, and by then the roster/import/invite steps have already spent most of it — the run reports "element(s) not found" for an upload that was never given its own stated wait. (The identical presign→PUT→finalize step passes in `portal-tasks.spec.ts`, which reaches it in seconds.) The retry then failed *earlier still*, on a duplicate "Shirt size" logistics field the first attempt created — the spec is not idempotent without a wipe | **SPEC-BUG (fixed** → per-test budget declared**)** |
| 9 | `speaker-content-ops.spec.ts:315` (M52) | `.portal-uploads` never appeared (60 s), `Test timeout of 30000ms exceeded` | Same as #8 | **SPEC-BUG (fixed)** |

Failure 6 in detail, because it is the one that looks like an app bug and is not. The spec framed
the embed inside a `data:` document ("opaque-origin — a stronger cross-origin proof"). A direct
Chromium probe shows what actually happens:

```
requestfailed: …/embed/ai-engineer-sandbox-event/sessions — net::ERR_BLOCKED_BY_RESPONSE
console[error]: Framing 'https://sb-web-preview.yi-ding.workers.dev/' violates the following
  Content Security Policy directive: "frame-ancestors *". The request has been blocked.
  Note that '*' matches only URLs with a network scheme…
```

CSP's `*` in `frame-ancestors` matches **network-scheme** ancestors only, so a `data:` (or
`about:blank`) host can never frame this embed no matter what the app serves. The host is now a
real https origin fulfilled locally through `page.route` (offline, deterministic, genuinely
cross-origin). The second cause was budget: this file's navigations sit inside `toPass` windows of
up to 120 s (the surfaces are `revalidate = 60`), which cannot fit in Playwright's 30 s default —
the run reported "element(s) not found" when the retry loop had simply been cut off. A
`testInfo.setTimeout(180_000)` per test is now declared; no assertion changed.

### 1d. Run 3 — `public-widgets-parity.spec.ts` after the fixes

```
21:55:45Z  E2E_SEED=0 pnpm exec playwright test e2e/public-widgets-parity.spec.ts
21:57:56Z  2 failed · 5 passed (2.2m)
```

The five surface-interaction tests (sessions, agenda, speakers, gallery, itinerary) all passed —
the three DOM/API spec bugs are gone. The run then hit **the deployment**, not an assertion: the
file's `beforeAll` arrange step

```
Error: PATCH /api/internal/speakers/9677e5d3-…/31ace3fc-… → 503
```

failed on both the retry and the run before it, which aborts the remaining tests in the describe
(they are reported as skipped/0 ms). The 503 is Cloudflare's 1102 "Worker exceeded resource
limits" — the same platform behaviour as Finding 2, here under sustained suite load rather than a
login burst.

### 1e. Run 4 — the four previously-failing specs against a freshly seeded `sb-test`

```
22:00:00Z  pnpm exec playwright test agenda-schedule public-widgets-parity review-operations speaker-content-ops
22:04:5xZ  4 failed · 2 flaky · 3 skipped · 12 passed (4.8m)
```

`public-widgets-parity.spec.ts` went **fully green**, including the one that had never run at all:

```
✓ embeds › all five embeds render populated content in a cross-origin host, and both variants are edge-cacheable (5.3s)
✓ embeds › a saved style/filter change and a disabled kill switch both take effect on the embed's next load (22.8s)
✓ one session and speaker agree across all five surfaces and the organizer's own admin API (5.0s)
✓ draft and declined-speaker data is absent from every direct surface, every embed, and both public APIs (8.2s)
```

(two of its twelve were flaky — passed on retry — both cold-cache first attempts).

The four remaining failures and what they were:

- **M54 auto-place** — now reaches the button, then `strict mode violation: /auto-place/i resolved
  to 2 elements`: the step's own fixture is named "E2E auto-place &lt;stamp&gt;" and the tray
  renders every unscheduled session as a button. Fixed spec-side (`name: "Auto-place", exact: true`).
- **M51 / M52 `speaker-content-ops`** — both `Test timeout of 30000ms exceeded` inside the 60 s
  upload wait, as triaged above. Fixed spec-side (a declared per-test budget).
- **review-operations** — failed *earlier* than in run 2, on
  `getByText('Round 2 · Blind shortlist')` not visible within 5 s (the plan exists and the API
  returns it; the previous run rendered it and got as far as the last step). A flake on top of the
  real, root-caused reminder gap in Findings 1.

### 1f. Runs 5 and 6 — `agenda-schedule` + `speaker-content-ops` after the last two fixes

Run 5 (`22:05:44Z`, fresh seed) put the deployment's own instability in the way of both remaining
specs rather than any assertion:

- `agenda-schedule` assisted placement failed on `the page logged console errors → "Failed to load
  resource: the server responded with a status of 503"`.
- `speaker-content-ops` failed on its very first call: `/api/test/login returned 503`.
- The suite's other four `agenda-schedule` tests passed (one flaky on a cold cache).

A bare health probe at `22:07:20Z` — three requests, no load — answered `503 200 200`, which is the
same Cloudflare 1102 ceiling as Findings 2 and 6.

Run 6 (`22:07:2xZ`, `E2E_SEED=0`, only the three tests in question) confirms the M54 fix:

```
✓ agenda-schedule › assisted placement › previews a deterministic placement, applies one accepted
  row, persists it, and shows a useful reason for a blacked-out speaker (6.4s)
```

**M54's deployed AC is therefore met**: Auto-place previewed both rows, the blacked-out speaker's
row carried its unavailability reason, one accepted row was applied through the audited
`moveSession` path, and the placement survived a reload (the step reads it back from
`/api/internal/agenda/sessions`).

M51 and M52 did **not** get a clean verification run. With the timeout fix in place, M52 now runs
its full 60 s upload wait instead of dying at 30 s — and still reports `.portal-uploads` missing.
M51's two attempts failed for two *different* reasons, neither of them the upload: the first on
Finding 4's duplicate "Shirt size" field (run 6 was `E2E_SEED=0`, so run 5's row was still there),
the retry on `/api/test/login returned 503`. Both modules are left **unverified, with the spec-side
timeout bug fixed** — but the M52 question is **no longer two-way**. §1g reads the retained failure
artifact, which rules out the 503 branch for M52's first attempt and localises the defect.

**Spec files changed by this run (spec-side only):** `e2e/helpers/seeded.ts`,
`e2e/helpers/landed.ts`, `e2e/admin-setup.spec.ts`, `e2e/agenda-schedule.spec.ts`,
`e2e/public-widgets-parity.spec.ts`, **`e2e/speaker-content-ops.spec.ts`** (the last one carries
the §1c #8/#9 timeout fix — two `test.beforeEach(({}, testInfo) => { testInfo.setTimeout(240_000); })`
blocks, one per describe; `public-widgets-parity`'s equivalent is `180_000`). No `src/**`, no
migration, no config.

### 1g. The retained failure artifacts, and what they settle about M52

Playwright wrote four artifacts for run 6's two failing tests. **`test-results/` is in
`.gitignore`**, so these do not survive a clean checkout — the decisive excerpts are therefore
quoted here rather than merely cited. Paths and mtimes (local `-0700`, so `+7h` for UTC):

| Artifact | mtime (UTC) | Failure |
|---|---|---|
| `test-results/speaker-content-ops-speake-58c63-…-bulk-email-chromium/error-context.md` | 22:07:38 | M51 attempt 1 — `strict mode violation: getByText('Shirt size') resolved to 2 elements` |
| `…-bulk-email-chromium-retry1/error-context.md` (+ `trace.zip`) | 22:07:40 | M51 retry — `/api/test/login returned 503` |
| `test-results/speaker-content-ops-conten-8d185-…-ZIP-export-chromium/error-context.md` | 22:07:56 | M52 attempt 1 — `.portal-uploads` not found after 60 s |
| `…-ZIP-export-chromium-retry1/error-context.md` (+ `trace.zip`) | 22:11:44 | M52 retry — `locator.fill: Test timeout of 240000ms exceeded` waiting for `getByLabel('Email address')` |

`test-results/.last-run.json` lists exactly these two test ids as the failures, which is what ties
the artifacts to run 6 rather than to an earlier run.

**The M52 artifact excludes the 503 branch for that attempt.** Its page snapshot shows the portal
task page rendered *normally* — banner, the five-item nav, `heading "Upload your slides"`, the
`pdf, key, pptx · up to 100 MB` policy line, the Comments panel — which a 503 does not produce. And
the upload control is in its **post-upload** state:

```yaml
- button "e2e-content-v1-1786399612497.pdf"
- button "Replace"
```

That pair is `FileUpload`'s `phase === "done"` branch (`src/shared/ui/app/file-upload.tsx:202-210`),
and `setPhase("done")` runs only *after* presign → PUT → **finalize** all return
(`file-upload.tsx:180-182`). So the browser half of M07's round trip succeeded on the preview.
`.portal-uploads` is a different thing: `task-detail.tsx:162` renders that `<ul>` only when
`task.uploads.length > 0`, and `task.uploads` is server state refreshed by `attach()` —
`POST /api/internal/portal/tasks/{id}/upload` followed by `router.refresh()`
(`src/features/portal/task-runtime/components/task-detail.tsx:88-92`).

**Therefore the surviving M52 question is one-way, not two:** the defect is in the
`attach()` → `POST …/tasks/{id}/upload` → `router.refresh()` path (or in the task query that feeds
`task.uploads`), *not* in presign/PUT/finalize and not in the 503 weather. A rerun should assert on
that POST's status directly rather than only on `.portal-uploads`. The retry adds nothing on this
point — it died 240 s later on a `getByLabel('Email address')` fill, far upstream.

(The 503s remain the honest explanation for M51's *retry* and for run 5 — Finding 6. They are not
an explanation for M52 attempt 1.)

---

## 2. The M42 S4 redo — what the deployment can and cannot prove

### 2a. The blocking fact, established first

`ADMIN_AUTH_PROVIDER` is **not set on the preview**, so it holds its default, `fallback`. Every
Better Auth path answers this application's own `NOT_FOUND` envelope rather than Better Auth:

```
2026-08-10T21:34:05Z
GET  /api/auth/get-session      404
GET  /api/auth/sign-in/email    404
GET  /api/auth/callback/google  404
GET  /api/auth/sign-in/social   404
POST /api/auth/sign-in/email    404 {"error":{"code":"NOT_FOUND"}}
POST /api/auth/sign-in/social   404 {"error":{"code":"NOT_FOUND"}}
```

`src/app/api/auth/[...action]/route.ts` returns exactly that for every non-legacy path while the
provider is `fallback`, and `GET` has no fallback surface at all. `wrangler.jsonc`'s preview `vars`
block carries no `ADMIN_AUTH_PROVIDER`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` or
`BETTER_AUTH_URL`; `DECISIONS.md` ("Product auth direction") records the Google credentials as
**local-dev only, `.dev.vars`**, with the preview/production halves still to be installed as worker
secrets.

**Therefore the deployed Better Auth round-trip, the deployed revocation proof, deployed
rehash-on-login, and the Google consent redirect cannot be executed against this deployment at
all.** They are blocked on an owner action (secrets + a redeploy), not on missing code. See
`needs_owner`.

### 2b. What the round-trip *does* prove on the shipping provider

Credentials had to be restored first — the suite's `--wipe` clears `users.password_hash` by design
("a seed that ships a working login is a seed that ships a vulnerability"):

```bash
DATABASE_URL="$NEON_TEST_URL" BOOTSTRAP_EVENT_ID=9677e5d3-… \
BOOTSTRAP_ADMIN_PASSWORD=… BOOTSTRAP_REVIEWER_PASSWORD=… pnpm admin:bootstrap
→ Admin bootstrap complete for event 9677e5d3-ccfc-5270-9b22-e551f8b4c57d
```

The resulting rows are exactly the state M42's rehash-on-login exists for — the legacy hash is
present on both sides of the switch:

| email | `users.password_hash` | `admin_accounts.provider_id` | `admin_accounts.password` |
|---|---|---|---|
| organizer@openboard.dev | `pbkdf2-sha25…` (legacy) | `credential` | `pbkdf2-sha25…` (legacy) |
| reviewer@openboard.dev | `pbkdf2-sha25…` (legacy) | `credential` | `pbkdf2-sha25…` (legacy) |

`upsertCredentialAccount` mirrored the bootstrap credential into `admin_accounts`, so the moment
the provider flag flips, `needsRehash` has a v1 hash to upgrade on first sign-in. That is the
*precondition* for AC 1, demonstrated on the real database; the rehash itself is not reachable
while the provider is `fallback`.

Deployed round-trip, `2026-08-10T21:50:10Z`:

```
POST /api/auth/sign-in  (wrong password)  → 401 {"error":{"code":"UNAUTHORIZED",…}}
POST /api/auth/sign-in  (real credential) → 200 {"data":{"signedIn":true}}
  Set-Cookie: ob_admin (Path=/; Max-Age=604800; Secure; HttpOnly; SameSite=lax)
GET  /api/internal/submissions/<event>/counts  with that cookie → 200
     {"all":28,"draft":5,"pending":11,"accept_queue":0,"decline_queue":0,"accepted":8,"declined":3,"withdrawn":1}
GET  the same route with no cookie             → 401 {"error":{"code":"UNAUTHORIZED","message":"Sign in required"}}
POST /api/auth/sign-out                        → 200, Set-Cookie: ob_admin=; Max-Age=0
GET  counts replaying the pre-sign-out cookie  → 200   ← the gap, reproduced
```

The last line is the deployed demonstration of *why* M42 exists: the fallback cookie is a
self-contained jose JWT with no server record, so sign-out clears the browser's copy and a captured
cookie keeps working until it expires. `revokeAdminSessions` returns 0 on this provider by design
(`admin.ts`), and `admin_sessions` is empty. Under Better Auth the same probe would have to answer
401 after a row delete — that is the proof still owed.

### 2c. Google

Not reachable: `POST /api/auth/sign-in/social` is 404 on the deployment (above), and the preview
holds no Google client id/secret, so there is no consent redirect to follow even up to Google's own
page. The real Google login was always the boundary; here the boundary sits one step earlier, at
the deployment's own configuration.

---

## 3. Deployed rate limiting (two independent 429s)

### 3a. The portal login-request IP limiter (P3-SEC, `rate_limit_buckets`)

A fresh address every request, so the per-contact throttle (3 per 10 min) can never be what
answers — this is the address-cycling defence itself:

```
2026-08-10T21:51:00Z  POST /api/internal/auth/portal/request  ×23, unique address each time
  requests  1–20 : 200 {"data":{"message":"If that address is on file, we've sent a code",…}}
  request     21 : 429 {"error":{"code":"RATE_LIMITED","message":"Too many requests. Please try again shortly."}}
  request     22 : 429
  tally: {"200":20,"429":2}
```

Exactly the configured policy: `limit: 20, windowMs: 10 min`, keyed `portal-login-request:<ip>`.

### 3b. The admin sign-in throttle (R1 item 4 / CP0's outstanding bullet)

Paced 1.5 s apart, one throwaway address, `2026-08-10T21:50:35Z`:

```
attempt 1: 401 in 320 ms   attempt 4: 401 in 162 ms
attempt 2: 401 in 202 ms   attempt 5: 401 in 150 ms
attempt 3: 401 in 231 ms   attempt 6: 429 in 106 ms {"code":"RATE_LIMITED","message":"Too many sign-in attempts. Try again later."}
```

Five attempts per email+IP per 15 minutes, then a block — the documented policy, demonstrated on
the deployed application rather than in a unit test. **This closes the "deployed application
auth-throttle proof" that CP0 and R1 item 4 have carried since rev. 5.**

An unpaced version of the same probe (seven requests back to back) is recorded as a finding: the
first five answered Cloudflare **error 1102, "Worker exceeded resource limits"** (HTTP 503) before
the sixth returned the 429. See Findings.

---

## 4. CSP and HSTS on the deployed preview

`2026-08-10T21:25:11Z`, `curl -sSI`:

**`/`** — 200, `x-nextjs-cache: HIT`

```
strict-transport-security: max-age=63072000; includeSubDomains; preload
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://*.r2.cloudflarestorage.com;
  form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
x-frame-options: DENY
```

**`/embed/ai-engineer-sandbox-event/sessions`** — 200

```
cache-control: s-maxage=60, stale-while-revalidate=31535940
content-security-policy: frame-ancestors *
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-content-type-options: nosniff
(no x-frame-options — deliberate; the embed is framed by other sites)
```

**`/e/ai-engineer-sandbox-event/sessions`** — 200, same `s-maxage=60` and the strict
(non-embed) policy including `frame-ancestors 'none'` + `X-Frame-Options: DENY`.

Two things worth stating plainly:

1. The embed **is** edge-cacheable again (`s-maxage=60, stale-while-revalidate`), so rev. 11's
   `private, no-cache` regression is fixed on the deployed artifact, not merely statically.
2. The `/e/**` twins carry `frame-ancestors 'none'` and `X-Frame-Options: DENY` — only `/embed/**`
   is exempted in `headersConfig`. That is deliberate per `security-headers.ts`, and the
   `/e/**` routes are the *direct* surfaces, not the embeddable ones.

R2 object serving, same session:

```
GET /f/ddbe841b-1cd0-52cb-8cc0-5f6ba1424b62 → 200, content-type: image/png,
    cache-control: public, max-age=31536000, immutable
```

which is M07's outstanding `curl -I /f/{id}` header check, on a real seeded headshot object in
`sb-files-preview`.

---

## 5. Accept → notify → a real Resend send

Driven entirely through the deployed admin API with a `TEST_AUTH` session, `2026-08-10T21:47:49Z`:

```
POST /api/test/login                                   → 200 {"data":{"signedIn":true}}
chosen: SESS-12 "Guardrails that do not annoy anyone"
        submission=7c109ae5-… contact=67078b2a-… (tim@openboard.events)
PATCH /api/internal/speakers/<event>/<contact>          → 200   email → yi.s.ding@gmail.com
POST  /api/internal/submissions/<event>/transition      → 200 {"changed":["7c109ae5-…"],"stale":[]}
communication_logs for this submission before notify: 0
POST  /api/internal/submissions/<event>/notify          → 200 {"accepted":["7c109ae5-…"],"declined":[],"emailsQueued":1,"skippedNoRecipient":[]}
```

Read back from `sb-test` three seconds later:

| id | status | template_key | provider_message_id | error | sent_at | recipient¹ |
|---|---|---|---|---|---|---|
| `5c197167-f340-42fd-820b-085d7ef36ea8` | `sent` | `submission_accepted` | `acf76cc2-1832-416e-8896-4cc884faeac1` | `null` | `2026-08-10T21:47:51.102Z` | `yi.s.ding@gmail.com` |

¹ Derived, not stored — `communication_logs` has no `recipient` column; this is the joined
`contacts.email`. See the §5 recipe in "Reproducibility" above.

and the submission itself: `status = accepted`, `notified_at = 2026-08-10T21:47:50.599Z`.

**Exactly one** `submission_accepted` row for that submission, a real Resend message id (not a log
stub — `EMAIL_MODE=send` with `EMAIL_ALLOWLIST=yi.s.ding@gmail.com`, and the address was
re-pointed through the contacts helper path precisely so a real send was possible), and the second
press is a clean no-op:

```
POST …/notify (second press) → 200 {"accepted":[],"declined":[],"emailsQueued":0}
communication_logs for this submission afterwards: 1
```

The suite's own `abstracts-decide` spec proved the same fan-out and idempotency laws across the
whole queued batch in both full runs (§1b).

---

## 6. Browser R2 upload

Proven by `portal-tasks.spec.ts` against the deployed preview in **both** full runs — the step
"upload a small fixture to the file-request task" drives M07's presign → PUT → finalize from a real
Chromium page, which is the only place CORS is actually exercised, and finalize checks what landed
in R2 rather than trusting the client. The phone-width spec (`test.use({ viewport: 390×844 })`)
passed alongside it, covering the 390 px half of the AC (no sideways scroll on portal home, the
task list and the task detail; the upload control at least 32 px tall). Server-side corroboration
is §4's `/f/{fileId}` 200 with an immutable cache header.

Recorded as an environment caveat, not a code defect: `pnpm seed`'s headshot upload chooses its
bucket from `APP_ENV` (`resolveSeedHeadshotTarget`), so a seed run with `APP_ENV=local` — which is
what `.dev.vars` sets, and therefore what the Playwright global setup inherits — writes the nine
headshots to the **local** `sb-files-dev` simulator, not to `sb-files-preview`. It did not break
anything here because the object keys are `seedId`-derived and identical across runs, so the
objects an earlier `APP_ENV=preview` seed uploaded are still the ones the rows point at. A seed run
intended to refresh the preview's R2 must be run with `APP_ENV=preview R2_BUCKET_NAME=sb-files-preview`.

---

## 7. Reviewer scoring and the Rating column

`2026-08-10T21:48:55Z`, the seeded reviewer signing in on the deployed preview and scoring three
abstracts from their **own** queue through the real evaluation route:

```
GET  /api/internal/evaluation/<event>/queue → 200
     plan=5e95d52f-… round=1 scale=1-5 criteria=Relevance(w2), Quality(w1) queue rows=8
POST …/reviews  e171ab7a-…  → 200 {"overallScore":4,"complete":true}
POST …/reviews  3127dbeb-…  → 200 {"overallScore":5,"complete":true}
POST …/reviews  f3648666-…  → 200 {"overallScore":3,"complete":true}
```

Then the organizer's own abstracts list, against an average computed by hand from `reviews` on
`sb-test` (`avg(overall_score)` over submitted, non-AI rows in the active plan — the same
definition `submission_ratings_v` uses):

| code | Rating column (`/api/internal/submissions/<event>`) | hand-computed | verdict |
|---|---|---|---|
| 18 | 3.165 (n=2) | 3.165 (n=2) | AGREE |
| 17 | 4.665 (n=2) | 4.665 (n=2) | AGREE |
| 1 | 4 (n=1) | 4 (n=1) | AGREE |

3/3. Worth recording because the first attempt did **not** agree: posting `overallScore` with an
empty `criterionScores` stored `null` and left the review "in progress". That is the documented
rule — with criteria on the plan the stored overall is *derived* by `weightedMean` and an
incomplete review contributes nothing to the average — and the deployed route enforces it. The
scores above are the weighted mean of the two criteria (`Relevance` w2, `Quality` w1), which is
why 4/5/3 land where they do once the seeded Round 1 scores are averaged in.

---

## 8. Findings

1. **Review reminders can never send for the seeded world (app/seed gap).**
   `POST /api/internal/evaluation/<event>/plans/<round2>/reminders` answers
   `{"enqueued":0,"skipped":3}` on the deployment. `listOutstandingReviewersIn` joins
   `contacts ON lower(c.email) = lower(u.email)`, and **no reviewer user has a `contacts` row** in
   the seeded event (`organizer@`, `reviewer@`, `reviewer2@openboard.dev` → 0 matching contacts
   each). `sendReviewRemindersIn` then skips every target by design ("a provisioning gap to report,
   not a reason to invent a contact here"). This is why `review-operations.spec.ts` fails its last
   step, and it is not a spec bug: M50's reviewer-provisioning path has to create the contact (or
   the seed has to), and both are app-side.
2. **Back-to-back sign-in attempts exceed the Worker CPU limit before the throttle answers.**
   Seven unpaced `POST /api/auth/sign-in` requests produced five Cloudflare **1102 "Worker exceeded
   resource limits"** (HTTP 503) responses and then a 429. Paced 1.5 s apart the same probe returns
   five clean 401s and then the 429 (§3b). PBKDF2 at 100,000 iterations runs on every attempt —
   including for an unknown address, against `DUMMY_PASSWORD_HASH` — so a burst is CPU-bound on the
   Workers Free plan. Security-wise the attacker still gets nothing; availability-wise a login
   burst degrades the whole Worker, and the 503s are indistinguishable from an outage in a log.
3. **The seeded `empty-conf` event has zero `email_templates` rows** while every other event has
   all 14. Migration `0014` backfills events that exist when it runs; `seedDefaultTemplates` fires
   at event creation. Any send scoped to that event would hit the dispatcher's terminal
   missing-template path.
4. **`speaker-content-ops.spec.ts` is not re-runnable without a wipe.** In run 2 its retry failed
   *earlier* than its first attempt, on a strict-mode violation for a duplicate "Shirt size"
   logistics field the first attempt had created; in run 6 (`E2E_SEED=0`) the same violation took
   the M51 test's **first** attempt, with the row left over from run 5 — see §1g. Retries against a
   shared database need the arrange steps to be upserts or uniquely named. Not fixed here — the
   timeout fix is what unblocks the first attempt, and making the arrange steps idempotent is a
   separate spec change worth doing deliberately.
5. **The M53 spec had never been executed against a real deployment before this run.** Four of its
   six failures were assertions written against an API shape and DOM classes that have never
   existed (§1c). Flipping a `landed.ts` gate is therefore not bookkeeping: it is the first time
   the spec is asked to be true.
6. **The preview intermittently answers 503 (Cloudflare 1102) under sustained suite load.** It cost
   run 3 its last four tests (a `PATCH /api/internal/speakers/...` in a `beforeAll`), one
   `/api/test/login` during the demonstrations, and M51's retry in run 6 (§1g). It always recovered
   on the next request. Same platform ceiling as Finding 2, reached by ordinary test traffic rather
   than a login burst; worth a look before anyone calls a deployed suite result "flaky".

## 9. needs_owner

1. **The M42 S4 redo needs a deployment change only the owner can make.** On `sb-web-preview`:
   set `ADMIN_AUTH_PROVIDER=better-auth`, and install `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   and `BETTER_AUTH_URL=https://sb-web-preview.yi-ding.workers.dev` as worker secrets (they are
   currently local-only in `.dev.vars`), plus that origin's `/api/auth/callback/google` in the
   Google OAuth client's authorised redirect URIs. Then, and only then, are the deployed Better
   Auth sign-in round-trip, the revocation proof (delete the `admin_sessions` row, replay the
   cookie, expect 401), rehash-on-login (`pbkdf2-sha256$…` → `pbkdf2-sha256-v2$…` in
   `admin_accounts.password` after one sign-in), and the Google consent redirect executable. The
   legacy credential rows are already in place for the rehash (§2b).
2. **A real Google login** remains a human step even after (1).
3. **Findings 1–3** are app-side and were deliberately not fixed by this run.
4. **M51 and M52 need one clean rerun on a calm preview, and M52 needs a code look regardless.**
   The spec-side timeout bug that was masking their upload step is fixed. Command:
   `pnpm exec playwright test e2e/speaker-content-ops.spec.ts` with a **fresh seed** — their arrange
   steps are not idempotent (Finding 4), which is what actually failed M51's first attempt in run 6.
   For M52 the rerun is confirmation, not diagnosis: §1g's retained artifact already shows the
   browser presign→PUT→finalize completing (`FileUpload` reached `phase === "done"`) while
   `.portal-uploads` stayed absent, so the defect sits in `attach()`'s
   `POST /api/internal/portal/tasks/{id}/upload` + `router.refresh()` path or in the task query
   behind `task.uploads`. That is an M52/M25 owner's bug to read, and the rerun should assert on
   that POST's status code so a future failure names itself.
5. **The `landed.ts` gates for M50–M54 are now `true`.** M53 and M54 have earned it in this run.
   M50, M51 and M52 have not yet gone green end-to-end — Findings 1 and the item above — so if the
   next run does not close them, the honest move is to send those three gates back to `false`
   *together with* the steps they gate, per the file's own rule.
