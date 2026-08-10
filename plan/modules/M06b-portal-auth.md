# M06b — Speaker/portal auth

| | |
|---|---|
| **Status** | IN REVIEW — **PR-OPEN** in [PR #12](https://github.com/yisding/symmetrical-happiness/pull/12): single-use hashed magic-link/OTP tokens with attempt limits, AES-GCM-encrypted `portal_login` delivery payloads, durable portal sessions, impersonation, cookie middleware, and issuance throttling serialized under a contact row lock. Used the documented contingency grant to create `features/portal/server/contacts.ts` with exactly `getOrCreateContact`/`updateContactFields`; **ownership returns to [M21](./M21-portal-shell.md) when the stack merges**. Blocking: the portal shell must bind to the authenticated contact rather than fixture/localStorage state, and no `portal_login` mail has been delivered or logged through M34. See [`../status.md`](../status.md) §2a. |
| **Workstream / executing agent** | WS-A Platform & Foundation (architect) |
| **Scheduled** | Sat PM. Does **not** gate CP1; blocks [M15](./M15-public-cfp-wizard.md)'s Account step (needed by Sun AM), [M21](./M21-portal-shell.md), [M27](./M27-speakers-admin.md), and (dashed) [M34](./M34-comms-outbox-dispatcher.md)/[M35](./M35-ics-calendar-invites.md) |
| **Size** | M–L |
| **Paths owned** | `src/features/auth/server/portal.ts`, `src/features/auth/server/tokens.ts`, `src/features/auth/components/{otp-form,magic-link-form,impersonation-banner}.tsx`, `src/app/(portal)/[eventSlug]/login/page.tsx`, `src/app/(portal)/[eventSlug]/verify/page.tsx`, `src/app/api/internal/auth/portal/**/route.ts`, and appended exports in `src/features/auth/index.ts` + the `/portal/:path*` matcher in `src/middleware.ts` (both files created by [M06a](./M06a-admin-auth.md) — append only, one commit each) |

## Objective
A speaker types their email on the portal login page, receives a 6-digit OTP (or a magic link), confirms it with a **POST**, and gets a per-(contact, event) session cookie. The same code path is what the CFP wizard's Account step calls, so **CFP identity IS the portal login**. Tokens are hashed, expiring, attempt-limited and issuance-throttled; ordinary comms links are minted through `issuePortalToken` at dispatch time. `portal_login` is the necessary exception: the request creates its OTP/link, encrypts the delivery payload for the outbox, and the dispatcher clears it after rendering. Admins can open the portal as any speaker with an attributed, bannered session. `EMAIL_FALLBACK_UI=1` is local/preview diagnostics only; production fails closed with the flag off.

## Dependencies
- **Hard (blocks start):** [M03](./M03-db-schema-migrations.md) (`contacts`, `portal_tokens` **with the ★ `attempts` column**, `portal_sessions`), [M04](./M04-shared-libs.md) (`getEnv`, `AppError`, `defineHandler`, `enqueueEmail`), [M06a](./M06a-admin-auth.md) (the auth barrel, `src/middleware.ts`, `getAdminSession()` for impersonation).
- **Soft (start against stub/fixture):**
  - **`getOrCreateContact(tx, eventId, email)`** (resolution #13) is owned by `features/portal/server/contacts.ts`, which **[M21](./M21-portal-shell.md) ships as its Step 0 in its first hour** precisely because this module needs it Sat PM. Build against [M02](./M02-shared-contracts.md)'s throwing stub. **Contingency only if WS-D has not pushed it by 14:00 Sat:** create the file containing exactly those two functions and nothing else, announce the temporary grant in `DECISIONS.md`, and hand it back to WS-D the same day. Never write `INSERT INTO contacts` anywhere else (grep #7).
  - [M34](./M34-comms-outbox-dispatcher.md) is a soft integration dependency: request/throttle/token tests assert the queued encrypted row without it, while the full `EMAIL_MODE=log` rendered-message round-trip is green only after M34 dispatches that row. Build against its Phase-0 dispatcher stub; do not bypass the outbox to make the module pass alone.

## Provides (interfaces others consume)
```ts
// @/features/auth  (appended to M06a's barrel)
export async function requirePortal(eventSlug: string): Promise<PortalSession>;
export type PortalSession = { contactId: ContactId; eventId: EventId; email: string;
                              impersonatedByUserId: UserId | null };
export async function ensurePortalSession(contactId: ContactId, eventId: EventId): Promise<void>;
export async function issuePortalToken(dbOrTx: DbOrTx, args: {                 // resolution #12
  contactId: ContactId; eventId: EventId; purpose: TokenPurpose; ttl: Duration; withOtp?: boolean;
}): Promise<{ tokenId: TokenId; raw: string; otp?: string; expiresAt: Date }>;
// `withOtp` is gated at this boundary: it throws AppError('VALIDATION') for any purpose other than
// 'magic_link' — OTP generation exists only for portal-login delivery, and requestPortalLogin is its
// only legitimate caller. ics_download/impersonation callers must not include withOtp in their call shape.
// The first parameter is DbOrTx (M02 §11), NOT TxDb: this helper performs a single INSERT, and the
// Ordinary comms dispatch calls it on the neon-http `db` handle (single INSERT). Portal login calls it
// inside requestPortalLogin's audited transaction so contact/token/outbox commit atomically.
// `otp` is returned only for portal-login issuance; token_hash/otp_hash are all that persist.
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
// otp  = 6 digits, generated only when the caller requests portal-login delivery
// stored: token_hash = sha256(raw), otp_hash = sha256(otp) when present, expires_at, attempts = 0
// returns { tokenId, raw, otp?, expiresAt } — raw values are never stored or logged in plaintext
```
TTLs: request-time `portal_login` challenge = 15 min for both the OTP and magic link (they share one `portal_tokens.expires_at`); `ics_download` 365 d (**`consumed_at` stays NULL forever** — calendar clients re-fetch); `impersonation` 5 min, single use; **dispatcher-minted ordinary `magic_link` embedded in a domain email body: 30 d** — the link must outlive the inbox, and [M34](./M34-comms-outbox-dispatcher.md) mints it fresh at send time with exactly this TTL.
`consumeToken(rawOrCode, {eventId, purpose})`:
1. hash → look up by `token_hash` (and by `(contact,purpose)` + code for the OTP form);
2. reject if `expires_at < now()` or `consumed_at IS NOT NULL`;
3. **on mismatch increment `attempts`; when `attempts >= 5` set `consumed_at = now()`** — the ★2 brute-force guard. A 6th attempt fails **even with the correct code**;
4. on success set `consumed_at = now()` in the same guarded UPDATE (`WHERE consumed_at IS NULL`), so a double-submit produces one session.
- **Done when:** PGlite test — 5 wrong codes then the right one → rejected; right code first → session; expired token → rejected; `ics_download` token stays unconsumed after two fetches; `issuePortalToken` with `withOtp:true` and purpose `ics_download` or `impersonation` throws `VALIDATION` (the boundary gate from Provides).

### 3. `POST /api/internal/auth/portal/request` — issuance, throttled
`requestPortalLogin(eventSlug, email)` is one of resolution #4's eight audited `withTx` functions. Inside it: resolve event → throttle check → **invalidate the contact's prior unconsumed `portal_login` challenges** (`UPDATE portal_tokens SET consumed_at = now() WHERE …` — data-model §1.1's "invalidate prior challenges"; only the newest code is ever live) → **`getOrCreateContact(tx, eventId, email.toLowerCase().trim())`** → `issuePortalToken(tx, {purpose:'magic_link', withOtp:true})` → encrypt `{otp, magicLink}` as the **v1 `portal_login` envelope** → **`enqueueEmail(tx, {eventId, templateKey:'portal_login', contactId, idempotencyKey: idem.portalLogin(eventId, contactId, tokenId), secretPayloadCiphertext})`**. The ciphertext is the only raw-token-bearing value at rest; M34 decrypts it just-in-time and clears it after render/send.
**The v1 envelope is a shared contract with [M34](./M34-comms-outbox-dispatcher.md) — byte-for-byte, both sides implement exactly this:** binary layout `[0x01 version ‖ 12-byte random nonce ‖ AES-256-GCM ciphertext+16-byte tag]` stored as `bytea`; key = HKDF-SHA-256(`SESSION_SECRET`, salt = empty, info = `"portal_login-v1"`); AAD = `` `${eventId}:${contactId}:${tokenId}` `` (binding the blob to its outbox row); plaintext = UTF-8 JSON `{otp, magicLink}`. The helper pair lives in `src/features/auth/server/secret-payload.ts` (`sealPortalLoginPayload` / `openPortalLoginPayload`) and M34 imports the opener from the `@/features/auth` barrel — one implementation, no re-derivation. M34's tests must cover a tampered byte (auth failure → row `failed`, ciphertext cleared) and an unknown version byte (row `failed`, never a crash).
**The template key is `portal_login`** — the 8th key in the frozen `TEMPLATE_KEYS` enum ([M02](./M02-shared-contracts.md) §1, [M03](./M03-db-schema-migrations.md) ★10, default copy in [M34](./M34-comms-outbox-dispatcher.md)'s `DEFAULT_TEMPLATES`, rendered in [M37](./M37-comms-admin-ui.md)'s rail). There is **no** `magic_link` template key; `communication_logs.template_key` is that pgEnum, so writing one would fail the insert and take the OTP path down. `portal_login` is the **one documented exception to resolution #12**: its token is minted here at enqueue time because the token *is* the payload being delivered — note that next to the call.
- **Throttle: 3 issuances per 10 minutes per (event, email)** — counted from `portal_tokens.created_at`; over the limit returns `RATE_LIMITED` with a friendly "check your inbox, or try again in a few minutes" (never leak whether the email exists).
- These application controls are mandatory on workers.dev. If a custom domain is attached, an available Cloudflare path-based rate rule may add defense-in-depth, but it is neither assumed nor a substitute for this throttle.
- Always responds "if that address is on file, we've sent a code" — no user enumeration.
- **Done when:** four rapid requests produce three token rows and one `RATE_LIMITED`, and `EMAIL_MODE=log` leaves exactly three `communication_logs` rows.

### 4. `/verify` page + `POST /verify` — POST-confirm, email-scanner-safe
The magic link lands on a **page** at `/portal/[eventSlug]/verify?token=…` whose button **POSTs** to consume. A corporate email scanner following the link with GET must **not** burn the token — this is the single most common magic-link failure in the wild.
The same page hosts the 6-digit OTP form (the primary path — no cross-device problem mid-CFP-wizard). On success: create `portal_sessions` (token_hash of a fresh 32-byte session token, `expires_at = now + 30d`), set cookie **`ob_portal_{eventId}`** (`httpOnly`, `Secure`, `SameSite=Lax`, path `/` — the cookie name is event-keyed so a speaker signed into two events holds two independent cookies and logging into the second event cannot overwrite the first's session; `requirePortal(eventSlug)` reads the cookie named for the slug's event), redirect to `?next=` or `/portal/[eventSlug]`.
- **Done when:** `curl -i "https://<preview>/portal/<slug>/verify?token=X"` returns 200 HTML and **does not** set `consumed_at`; the subsequent POST does.

### 5. `EMAIL_FALLBACK_UI=1` — local/preview diagnostics (~20 lines)
When the flag is set outside production, the request response includes the OTP and magic-link URL and the verify page renders them in a bordered "Development / fallback mode" panel. This unblocks local/preview testing while Resend is unavailable; it is not acceptable evidence for the judge path. Production configuration fixes the flag to `0`, the post-deploy smoke asserts no secret appears, and the admin comms log redacts `portal_login` credentials after a real send.
- **Done when:** with the flag on in preview, a fresh browser completes login without email; with it off, the code appears nowhere in the response body; production smoke fails if the flag is enabled.

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
- **Never log or store the raw token in plaintext.** `portal_tokens` stores hashes only. The `portal_login` outbox exception stores the short-lived delivery payload only as AES-GCM ciphertext, clears it on a terminal dispatch path, and redacts the production rendered body. The same storage policy covers **every** live credential the dispatcher mints: production-persisted `communication_logs` bodies never retain a usable token query param for any template key — [M34](./M34-comms-outbox-dispatcher.md) §5 redacts ordinary magic-link/ICS tokens from stored production bodies too (the sent email carries the real link; the audit log carries the redacted one).
- **Cookie scope:** the portal cookie is per-(contact, event) **and event-keyed by name** (`ob_portal_{eventId}`, §4). A speaker with contacts in two events holds two simultaneous sessions in one browser — per-event identity, no global speaker (data-model §3.3), and neither login evicts the other. The AC suite includes the two-event test: authenticate the same speaker into two seeded events, then assert both portals still resolve their own sessions.
- **Timezone edge case:** expiries are `timestamptz` compared against `now()` in SQL, never against a client clock. The "expires in 15 minutes" copy is rendered with `formatInZone`.
- **Concurrent-edit edge case:** two tabs submitting the same OTP → one session, one `consumed_at`; the loser gets a friendly "already used — you're signed in" rather than an error.
- **Empty-state edge case:** a valid session whose contact has zero submissions and zero tasks must render [M21](./M21-portal-shell.md)'s designed empty states, not blank widgets. The seeded empty second event proves it.

## If blocked
- **`getOrCreateContact` still a stub at 14:00 Sat and WS-D unreachable:** create `features/portal/server/contacts.ts` with exactly the two exported functions (nothing else), announce it in `DECISIONS.md`, and hand it back to WS-D ([M21](./M21-portal-shell.md) Step 0 is its owner) the same day. This is a 30-line file and it unblocks the CFP Account step, which is on the critical path — but it is a contingency, not the plan.
- **Resend unverified:** everything in this module is testable under `EMAIL_MODE=log`; verify against `communication_logs` rows. Turn on `EMAIL_FALLBACK_UI=1` on the preview so other agents can log into the portal without email at all.
- **Running long (this is M–L and the last WS-A feature module):** ship in this order — request/verify/session (the golden path), then attempts+throttle, then impersonation, then fallback UI. Impersonation is cut-line #13; the OTP round-trip is not.
- **Done early:** start [M09](./M09-seed-demo-script.md)'s orchestrator, or write the [M10](./M10-e2e-release.md) `portal-tasks.spec` login helper — both are on the architect's lane next.
