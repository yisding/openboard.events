# M06b — Speaker/portal auth

| | |
|---|---|
| **Status** | NOT STARTED |
| **Workstream / executing agent** | WS-A Platform & Foundation (architect) |
| **Scheduled** | Sat PM. Does **not** gate CP1; blocks [M15](./M15-public-cfp-wizard.md)'s Account step (needed by Sun AM), [M21](./M21-portal-shell.md), [M27](./M27-speakers-admin.md), and (dashed) [M34](./M34-comms-outbox-dispatcher.md)/[M35](./M35-ics-calendar-invites.md) |
| **Size** | M–L |
| **Paths owned** | `src/features/auth/server/portal.ts`, `src/features/auth/server/tokens.ts`, `src/features/auth/components/{otp-form,magic-link-form,impersonation-banner}.tsx`, `src/app/(portal)/[eventSlug]/login/page.tsx`, `src/app/(portal)/[eventSlug]/verify/page.tsx`, `src/app/api/internal/auth/portal/**/route.ts`, and appended exports in `src/features/auth/index.ts` + the `/portal/:path*` matcher in `src/middleware.ts` (both files created by [M06a](./M06a-admin-auth.md) — append only, one commit each) |

## Objective
A speaker types their email on the portal login page, receives a 6-digit OTP (or a magic link), confirms it with a **POST**, and gets a per-(contact, event) session cookie. The same code path is what the CFP wizard's Account step calls, so **CFP identity IS the portal login**. Tokens are hashed, expiring, attempt-limited and issuance-throttled; the comms dispatcher mints portal links through `issuePortalToken` at send time so nothing stale ages in the outbox. Admins can open the portal as any speaker with an attributed, bannered session. With `EMAIL_FALLBACK_UI=1` the verify page surfaces the code inline, which is the whole email-outage contingency.

## Dependencies
- **Hard (blocks start):** [M03](./M03-db-schema-migrations.md) (`contacts`, `portal_tokens` **with the ★ `attempts` column**, `portal_sessions`), [M04](./M04-shared-libs.md) (`getEnv`, `AppError`, `defineHandler`, `enqueueEmail`), [M06a](./M06a-admin-auth.md) (the auth barrel, `src/middleware.ts`, `getAdminSession()` for impersonation).
- **Soft (start against stub/fixture):**
  - **`getOrCreateContact(tx, eventId, email)`** (resolution #13) is owned by `features/portal/server/contacts.ts`, which **[M21](./M21-portal-shell.md) ships as its Step 0 in its first hour** precisely because this module needs it Sat PM. Build against [M02](./M02-shared-contracts.md)'s throwing stub. **Contingency only if WS-D has not pushed it by 14:00 Sat:** create the file containing exactly those two functions and nothing else, announce the temporary grant in `DECISIONS.md`, and hand it back to WS-D the same day. Never write `INSERT INTO contacts` anywhere else (grep #7).
  - Email delivery: everything works under `EMAIL_MODE=log` — the OTP lands as a rendered `communication_logs` row. The dispatcher ([M34](./M34-comms-outbox-dispatcher.md)) is not required for this module's ACs.

## Provides (interfaces others consume)
```ts
// @/features/auth  (appended to M06a's barrel)
export async function requirePortal(eventSlug: string): Promise<PortalSession>;
export type PortalSession = { contactId: ContactId; eventId: EventId; email: string;
                              impersonatedByUserId: UserId | null };
export async function ensurePortalSession(contactId: ContactId, eventId: EventId): Promise<void>;
export async function issuePortalToken(dbOrTx: DbOrTx, args: {                 // resolution #12
  contactId: ContactId; eventId: EventId; purpose: TokenPurpose; ttl: Duration;
}): Promise<{ raw: string; expiresAt: Date }>;
// The first parameter is DbOrTx (M02 §11), NOT TxDb: this helper performs a single INSERT, and the
// comms dispatcher calls it on the neon-http `db` handle deliberately, so no 5th withTx path is opened
// (resolution #4). Inside an existing transaction, callers pass their `tx` — same signature, same code.

// Non-consuming verifier — the ONLY way another feature checks a token. Hashes, checks
// `expires_at > now()` and `consumed_at IS NULL`, and WRITES NOTHING. M35's /cal routes call this so
// `ics_download` tokens keep `consumed_at` NULL forever (calendar clients re-fetch).
export async function verifyPortalToken(raw: string, opts: { purpose: TokenPurpose }):
  Promise<{ contactId: ContactId; eventId: EventId } | null>;
export const portalAuth: () => HandlerGuard;
export async function startImpersonation(eventId: EventId, contactId: ContactId): Promise<void>;
```
- Pages: `/portal/[eventSlug]/login`, `/portal/[eventSlug]/verify`.
- Routes: `POST /api/internal/auth/portal/request` (email → OTP + magic link), `POST /api/internal/auth/portal/verify` (code or token → session), `POST /api/internal/auth/portal/logout`, `POST /api/internal/auth/portal/impersonate` (admin-gated).
- Consumed by: [M15](./M15-public-cfp-wizard.md) (Account step calls `ensurePortalSession` and then `upsertDraft`), [M21](./M21-portal-shell.md)/[M22](./M22-speaker-profile.md)/[M25](./M25-task-runtime.md)/[M26](./M26-resource-pages.md)/[M41](./M41-speaker-edit-until-close.md) (`requirePortal`), [M27](./M27-speakers-admin.md) ("Open portal as X"), **[M34](./M34-comms-outbox-dispatcher.md) (`issuePortalToken` at send time) and [M35](./M35-ics-calendar-invites.md) (`issuePortalToken` + **`verifyPortalToken`** for both `/cal` routes — a hard dependency for M35's route steps, not a soft one)**.

## Step-by-step implementation

### 1. CONTRACT-FIRST SLICE — export the five signatures, real types, stub bodies (first 20 minutes)
Append the block above to `src/features/auth/index.ts` with `notImplemented()` bodies except `requirePortal`, which under `TEST_AUTH=1` returns a fixture session for the seeded speaker. Push immediately — [M21](./M21-portal-shell.md) starts Sat PM and needs `requirePortal` to type and to work in dev.
- **Done when:** [M21](./M21-portal-shell.md) can render a portal page as the fixture contact.

### 2. `tokens.ts` — hashed, expiring, attempt-limited
```ts
issuePortalToken(tx, {contactId, eventId, purpose, ttl})
// raw = 32 bytes from crypto.getRandomValues → base64url  (magic_link / ics_download / impersonation)
// otp  = 6 digits, generated alongside for purpose 'magic_link'
// stored: token_hash = sha256(raw) via Web Crypto; expires_at = now + ttl; attempts = 0
// returns { raw, expiresAt } — the RAW value is never stored and never logged
```
TTLs: `magic_link` 15 min (OTP), 60 min (link); `ics_download` 365 d (**`consumed_at` stays NULL forever** — calendar clients re-fetch); `impersonation` 5 min, single use; **dispatcher-minted `magic_link` embedded in an email body: 30 d** — the link must outlive the inbox, and [M34](./M34-comms-outbox-dispatcher.md) mints it fresh at send time with exactly this TTL.
`consumeToken(rawOrCode, {eventId, purpose})`:
1. hash → look up by `token_hash` (and by `(contact,purpose)` + code for the OTP form);
2. reject if `expires_at < now()` or `consumed_at IS NOT NULL`;
3. **on mismatch increment `attempts`; when `attempts >= 5` set `consumed_at = now()`** — the ★2 brute-force guard. A 6th attempt fails **even with the correct code**;
4. on success set `consumed_at = now()` in the same guarded UPDATE (`WHERE consumed_at IS NULL`), so a double-submit produces one session.
- **Done when:** PGlite test — 5 wrong codes then the right one → rejected; right code first → session; expired token → rejected; `ics_download` token stays unconsumed after two fetches.

### 3. `POST /api/internal/auth/portal/request` — issuance, throttled
Input `{eventSlug, email}` → resolve event → **`getOrCreateContact(tx, eventId, email.toLowerCase().trim())`** → `issuePortalToken` → **`enqueueEmail(tx, {templateKey:'portal_login', contactId, idempotencyKey: idem.otp(eventId, contactId, tokenId), refs:{}})`** in the **same transaction**.
**The template key is `portal_login`** — the 8th key in the frozen `TEMPLATE_KEYS` enum ([M02](./M02-shared-contracts.md) §1, [M03](./M03-db-schema-migrations.md) ★10, default copy in [M34](./M34-comms-outbox-dispatcher.md)'s `DEFAULT_TEMPLATES`, rendered in [M37](./M37-comms-admin-ui.md)'s rail). There is **no** `magic_link` template key; `communication_logs.template_key` is that pgEnum, so writing one would fail the insert and take the OTP path down. `portal_login` is the **one documented exception to resolution #12**: its token is minted here at enqueue time because the token *is* the payload being delivered — note that next to the call.
- **Throttle: 3 issuances per 10 minutes per (event, email)** — counted from `portal_tokens.created_at`; over the limit returns `RATE_LIMITED` with a friendly "check your inbox, or try again in a few minutes" (never leak whether the email exists).
- WAF rate rules already cover this route and the verify route at the edge ([M01](./M01-scaffold-ci-deploy.md), configured Friday).
- Always responds "if that address is on file, we've sent a code" — no user enumeration.
- **Done when:** four rapid requests produce three token rows and one `RATE_LIMITED`, and `EMAIL_MODE=log` leaves exactly three `communication_logs` rows.

### 4. `/verify` page + `POST /verify` — POST-confirm, email-scanner-safe
The magic link lands on a **page** at `/portal/[eventSlug]/verify?token=…` whose button **POSTs** to consume. A corporate email scanner following the link with GET must **not** burn the token — this is the single most common magic-link failure in the wild.
The same page hosts the 6-digit OTP form (the primary path — no cross-device problem mid-CFP-wizard). On success: create `portal_sessions` (token_hash of a fresh 32-byte session token, `expires_at = now + 30d`), set cookie `ob_portal` (`httpOnly`, `Secure`, `SameSite=Lax`, path `/`), redirect to `?next=` or `/portal/[eventSlug]`.
- **Done when:** `curl -i "https://<preview>/portal/<slug>/verify?token=X"` returns 200 HTML and **does not** set `consumed_at`; the subsequent POST does.

### 5. `EMAIL_FALLBACK_UI=1` — judge mode (~20 lines, the email-outage contingency)
When the flag is set, the request response includes the OTP and the magic-link URL, and the verify page renders them inline in a bordered "Development / fallback mode" panel. This is the pre-decided fallback if the Resend domain is unverified at the Sun-noon decision point (risk #7). `docs/demo-script.md` additionally documents "grab the rendered link from the admin Comms Log screen" ([M37](./M37-comms-admin-ui.md) stores rendered bodies).
- **Done when:** with the flag on, a fresh browser completes login without any email; with it off, the code appears nowhere in the response body (assert with grep in a test).

### 6. `requirePortal` + `portalAuth` — IDOR-proof by construction
```ts
requirePortal(eventSlug) → { contactId, eventId, email, impersonatedByUserId }
```
Reads the cookie → `portal_sessions` row → **verifies the session's `event_id` matches the slug's event**. Every portal repo function then takes `(eventId, contactId, …)` (R4); a mismatched `contactId` returns nothing rather than someone else's data.
- **Done when:** the PGlite IDOR test in [M21](./M21-portal-shell.md) passes: querying with contact B's id under contact A's session returns zero rows.

### 7. `ensurePortalSession(contactId, eventId)` — shared with the CFP Account step
Creates (or refreshes) the same `portal_sessions` row and cookie **without** a token round-trip, for the case where the caller has already proven identity (the wizard just verified the OTP). [M15](./M15-public-cfp-wizard.md) calls this and then `upsertDraft(eventId, contactId, formId, formVersion)` — the server draft row exists from that moment, pinned to the rendered `form_version`.
- **Done when:** completing the Account step in the wizard leaves the user logged into `/portal/[eventSlug]` in the same browser with no extra step.

### 8. Impersonation — "Open portal as X"
`POST /api/internal/auth/portal/impersonate` guarded by `adminAuth()`: `requireAdmin(eventId)` → mint an `impersonation` token (5 min, single use) → redirect the admin to `/portal/[slug]/verify?token=…&impersonate=1`; consuming it creates a `portal_sessions` row with **`impersonated_by_user_id = adminSession.userId`**.
`<ImpersonationBanner>` renders on every portal page when that column is set: *"Viewing as {name} ({email}) — **Back to Admin**"*. Writes made in this session are attributable through the session row (data-model §8's audit minimum).
- **Done when:** [M27](./M27-speakers-admin.md)'s speaker-detail link opens the portal as that speaker, the banner shows, and Back-to-Admin returns to `/events/[id]/speakers/[contactId]`.

### 9. Wire `issuePortalToken` for comms (resolution #12)
Export it from the barrel and document the rule at the definition, verbatim: *"Portal magic-link and ICS tokens are minted **at send time by the comms dispatcher**, never at enqueue time by domain features — fresh expiry, nothing stale ages in the outbox. `/cal/[token]` ICS tokens go through this same helper."* [M34](./M34-comms-outbox-dispatcher.md) calls it inside its send loop; [M35](./M35-ics-calendar-invites.md) calls it with `purpose: 'ics_download'`.

## Acceptance criteria
Catalog AC, verbatim: *speaker OTP round-trips via `EMAIL_MODE=log` log row; 6th wrong OTP attempt rejects even with the right code (PGlite); email-scanner GET does not consume the token; impersonation banner shows and writes are attributed; fallback flag surfaces the code.*

```bash
pnpm vitest run tests/integration/portal-auth.test.ts   # attempts guard, expiry, throttle, single-use, IDOR
curl -i -X POST https://<preview>/api/internal/auth/portal/request \
  -d '{"eventSlug":"ai-engineer-sandbox-event","email":"speaker@example.com"}'   # 200, generic message
psql "$DATABASE_URL" -c "select template_key, status, subject_rendered from communication_logs order by created_at desc limit 1"
curl -i "https://<preview>/portal/<slug>/verify?token=RAW"                       # 200; consumed_at still NULL
curl -i -X POST https://<preview>/api/internal/auth/portal/verify -d '{"code":"123456",...}'  # set-cookie
pnpm exec playwright test e2e/portal-tasks.spec.ts       # (M10) portal login path
```

## Guardrails
- **Resolution #12 is absolute:** no domain feature mints a portal token. If [M18](./M18-submission-mutations-notify.md) or [M28](./M28-sessions-crud.md) "just needs a link", the answer is the dispatcher mints it at send time. A token created at enqueue time and sent 40 minutes later has already half-expired.
- **Resolution #13 is absolute:** every contact write goes through `getOrCreateContact`/`updateContactFields`. This module is the CFP Account step's writer and therefore the first enforcement point (grep #7).
- **POST-confirm only.** A GET that consumes the token is the "my magic link was already used" bug that will absolutely happen with a judge's corporate inbox.
- **OTP first, link second.** The CFP wizard's Account step is mid-flow on one device; a magic link that opens a new tab loses the wizard state. The OTP is the tested path; the link is the convenience.
- **No user enumeration:** identical response and timing whether or not the contact exists. Errors are generic.
- **Never log or store the raw token.** `token_hash` only; the raw value exists in the response/email and in memory.
- **Cookie scope:** the portal cookie is per-(contact, event). A speaker with contacts in two events has two sessions — per-event identity, no global speaker (data-model §3.3).
- **Timezone edge case:** expiries are `timestamptz` compared against `now()` in SQL, never against a client clock. The "expires in 15 minutes" copy is rendered with `formatInZone`.
- **Concurrent-edit edge case:** two tabs submitting the same OTP → one session, one `consumed_at`; the loser gets a friendly "already used — you're signed in" rather than an error.
- **Empty-state edge case:** a valid session whose contact has zero submissions and zero tasks must render [M21](./M21-portal-shell.md)'s designed empty states, not blank widgets. The seeded empty second event proves it.

## If blocked
- **`getOrCreateContact` still a stub at 14:00 Sat and WS-D unreachable:** create `features/portal/server/contacts.ts` with exactly the two exported functions (nothing else), announce it in `DECISIONS.md`, and hand it back to WS-D ([M21](./M21-portal-shell.md) Step 0 is its owner) the same day. This is a 30-line file and it unblocks the CFP Account step, which is on the critical path — but it is a contingency, not the plan.
- **Resend unverified:** everything in this module is testable under `EMAIL_MODE=log`; verify against `communication_logs` rows. Turn on `EMAIL_FALLBACK_UI=1` on the preview so other agents can log into the portal without email at all.
- **Running long (this is M–L and the last WS-A feature module):** ship in this order — request/verify/session (the golden path), then attempts+throttle, then impersonation, then fallback UI. Impersonation is cut-line #16; the OTP round-trip is not.
- **Done early:** start [M09](./M09-seed-demo-script.md)'s orchestrator, or write the [M10](./M10-e2e-release.md) `portal-tasks.spec` login helper — both are on the architect's lane next.
