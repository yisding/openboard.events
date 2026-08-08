# Openboard decisions

## Pinned versions

- Next.js `15.5.23` and `@opennextjs/cloudflare` `1.20.2`. OpenNext supports the latest Next.js 15 minor and the pair is frozen for the build.
- React `19.1.9`; zod v4; `date-fns` + `date-fns-tz` for the centralized time API.

## Spike results (S1–S4, C1–C2)

- Local Next.js production build: passed on 2026-08-08 with 42 routes.
- OpenNext Cloudflare build: passed on 2026-08-08; `.open-next/worker.js` was generated successfully.
- Unit checks cover condition evaluation, half-open interval overlap, agenda conflicts, sanitization, and RFC 5545 calendar generation (21 passing tests).
- Deployed Neon transactions, Auth.js, R2, Resend delivery/idempotency, and preview URL checks remain pending environment credentials.

## Deferred spikes (Sat AM)

- [ ] Revalidate-60 behavior on a deployed public page
- [ ] Browser presigned R2 upload with CORS
- [ ] Apply both PostgreSQL migrations to a disposable Neon branch
- [ ] Embed `frame-ancestors *` survives the adapter

## Adopted fallbacks

- The local demo uses a typed, persisted browser store when external services are absent. Production adapters remain isolated behind server interfaces.

## Discord clarifications

- No clarifications recorded yet.

## Walkthrough-video diffs

- No video artifact is present in this checkout; the written plan is authoritative.

## Infra facts (Neon/R2/Resend/Airtable/WAF ids)

- Credentials are not present in the repository and no external resources have been mutated.

## CP1 freeze record

- Contracts, migration schema, feature barrels, version pair, and invariant rules freeze after the foundation PR is accepted.
