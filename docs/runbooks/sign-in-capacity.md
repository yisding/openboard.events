# Admin sign-in capacity

Password verification uses PBKDF2-SHA256 at 100,000 iterations in native WebCrypto. That work
remains intentionally unchanged until a replacement has measured Worker CPU data and a
rehash-on-login migration. Capacity is protected before the verifier instead of weakening the
credential.

## Budgets and controls

| Layer | Budget | Scope and purpose |
|---|---:|---|
| Distributed IP burst guard | 1 request / 1 second | Keyed by trusted client IP in Postgres. |
| Distributed account burst guard | 3 requests / 1 second | Keyed by normalized caller-supplied account string; it does not query whether the account exists. |
| Durable abuse throttle | 5 requests / 15 minutes | Existing account+IP control in `admin_login_attempts`; a successful or email-not-verified credential clears it. |
| Per-isolate verification | 1 in flight | Immediate fuse around the Better Auth password handler. Overlap receives `429` before another PBKDF2 operation starts. |
| Deployed burst latency | p95 at most 5 seconds | Twelve simultaneous unknown-account attempts from one runner; at least eleven must be controlled `429`s and every response must be `401` or `429`. |

`POST /api/auth/sign-in` and Better Auth's native `POST /api/auth/sign-in/email` share this exact
path. The IP and account counters run before the durable throttle, and all three run before
password verification. An unknown account and a wrong password still produce the same generic
`401`; rate limits depend only on caller-supplied keys, never on whether an account exists.

Both distributed keys are hashed before storage. The database guard uses one
`INSERT ... ON CONFLICT DO UPDATE ... RETURNING` statement. PostgreSQL
serializes conflicting updates on the key, so a concurrent burst cannot let every request observe
the old count. `tests/integration/rate-limit.test.ts` verifies the 1-allowed/11-rejected contract.

## Deployment proof

Every preview deployment runs:

```bash
pnpm probe:auth-capacity https://sb-web-preview.yi-ding.workers.dev
```

The probe uses a unique nonexistent address, prints only status counts and latency, and fails on a
network error, any status other than `401`/`429`, fewer than eleven `429`s, or p95 above five
seconds. It deliberately remains unpaced: pacing would conceal the Worker-overload failure this
gate is intended to catch. Production promotion remains dependent on the complete preview canary.

## Logs and incident response

Cloudflare Workers Logs can be filtered on these structured message names:

| Message | `code` values | Meaning |
|---|---|---|
| `auth.credential_throttle` | `ip_limited`, `account_limited`, `durable_limited`, `isolate_capacity_limited` | Which anonymous capacity layer shed the request. |
| `auth.credential_request` | `accepted`, `rejected`, `failed` | End-to-end Better Auth handler result and `durationMs`. |
| `auth.password_verification` | `accepted`, `rejected`, `malformed_hash`, `downgrade_rejected`, `failed` | Exact PBKDF2 result and `durationMs`. |

Entries contain a request/ray id, decision, and duration only. They never contain an address, IP,
password, hash, or response body. Cloudflare error `1102` may terminate an invocation before
application logging runs, so the deployed probe's `5xx` prohibition and the platform's invocation
outcome are the authoritative CPU-failure signals.

Treat any deployed-probe `5xx`, timeout, or p95 breach as a release blocker. During an incident,
compare `auth.password_verification` duration with `auth.credential_throttle` decisions and the
Cloudflare invocation outcome. A surge of controlled `429`s with no `5xx` means the guard is doing
its job; sustained legitimate-user limiting means the one-second distributed window should be
reviewed with evidence, not bypassed.

Rollback is code-only: revert the route/capacity module and deployment probe together. The short
burst rows use the existing `rate_limit_buckets` retention path and require no schema rollback.
Keep the durable 15-minute throttle in place during any rollback.
