# DMARC enforcement

`hello@mail.openboard.events` is the only production From address. Resend is the only approved
sender. `_dmarc.openboard.events` remains the organizational reporting record; the enforcement
record for the application sender is `_dmarc.mail.openboard.events`, so a rollout cannot
accidentally reject unrelated apex-domain mail.

Primary owner: `@yisding`, as repository, Cloudflare-zone, and production-environment owner.
The production environment approval is the change-control boundary. Review status weekly while
the policy is stable and daily during an enforcement stage.

## Aggregate reporting

Run **DMARC operations** with `enable-reporting`. The production-protected workflow calls
Cloudflare's DMARC Reports API, which idempotently enables collection and ensures its generated
`rua` address is present on the apex DMARC record. A successful JSON result must say
`reportingConfigured: true`. `awaitingFirstReport: true` is expected for up to 24 hours after
enablement.

The workflow deliberately does not reuse the Worker deployment credential. Its production
environment must contain `CLOUDFLARE_DMARC_API_TOKEN`, scoped only to the
`openboard.events` zone with Cloudflare's **Email Security DMARC Reports Read** and
**Email Security DMARC Reports Write** permissions, plus the non-secret `CLOUDFLARE_ZONE_ID`
environment variable. The explicit ID means the token does not need Zone Read. Never add DNS,
Workers, account-wide, or other zone permissions to this credential.

Use the `status` operation for a read-only snapshot. It records the live policy, report URI,
Cloudflare's approved-source inventory, and whether the first aggregate report has arrived.
Cloudflare dashboard → **Email → DMARC Management** owns the per-source pass/fail detail; inspect
**View reports** and **View all** before approving any enforcement step.

## Live rollout record

Aggregate reporting was enabled at `2026-08-15T03:40:22Z` by protected workflow
[run 31862396508](https://github.com/yisding/openboard.events/actions/runs/31862396508) on
main commit `a0fd73be`. The operation returned `changed: true`, `reportingConfigured: true`,
`policy: none`, and an empty approved-source inventory. Cloudflare and Google public DNS both
resolved the resulting single apex record with Cloudflare's generated `rua` immediately after
the operation.

The seven-day reporting dwell starts at that timestamp. `2026-08-22T03:40:22Z` is therefore
the earliest possible quarantine-10 entry, not an automatic promotion date: at least two
independent receivers must first contribute reports, every legitimate source must be identified,
and Gmail and Outlook test messages must show `dmarc=pass`.

## Stage gates

The application currently expects only Resend. Its aligned path is:

- header From domain: `mail.openboard.events`
- DKIM selector: `resend._domainkey.mail.openboard.events`
- return-path SPF: `send.mail.openboard.events` → Amazon SES

For each step, attach the DMARC workflow JSON and Cloudflare's selected-period source totals to
the implementation PR. Count messages, not merely source rows. A legitimate message is clean
when DMARC passes through aligned DKIM or SPF. Unknown failing sources may be spoofing; unknown
passing sources are unapproved senders and block promotion.

| Stage | Minimum evidence before entry | Minimum dwell before next stage |
| --- | --- | --- |
| reporting (`p=none`) | reporting configured; test mail shows `dmarc=pass` | 7 days with reports from at least two independent receivers |
| quarantine 10% | every legitimate source identified and aligned; zero unknown passing sources | 48 hours and two aggregate-report periods |
| quarantine 50% | no legitimate DMARC failures or delivery regression at 10% | 48 hours and two aggregate-report periods |
| quarantine 100% | no legitimate DMARC failures or delivery regression at 50% | 7 days |
| reject 100% | zero unidentified legitimate senders and zero legitimate failures at full quarantine | permanent; review weekly |

The percentage stages reduce risk, but receivers are allowed to ignore `pct`; keep the evidence
gate even when observed filtering appears lower than the published percentage.

## Monitoring and rollback

Stop or roll back one stage immediately when any of these occurs:

- one legitimate source or message fails DMARC;
- a passing source is not Resend/Amazon SES and has not been explicitly approved;
- production delivery failures or bounces rise above the alerting runbook's existing threshold;
- SPF or DKIM DNS no longer resolves, Cloudflare reports a DMARC configuration status, or the
  application From domain changes.

Rollback changes only `_dmarc.mail.openboard.events`, using the preceding stage's exact record.
DNS TTL is 300 seconds; verify authoritative DNS and two public resolvers within 10 minutes. If
reject is active and legitimate mail is failing, roll directly back to `p=none`, preserve the
Cloudflare `rua`, and treat the sending path as an incident. Never disable aggregate reporting
during rollback.

After every change, verify:

1. `_dmarc.openboard.events` and `_dmarc.mail.openboard.events` return one valid TXT record each.
2. `send.mail.openboard.events` resolves the Resend/Amazon SES SPF and return-path MX records.
3. `resend._domainkey.mail.openboard.events` resolves DKIM.
4. A production message delivered to Gmail and Outlook has `dmarc=pass` in its authentication
   results.
