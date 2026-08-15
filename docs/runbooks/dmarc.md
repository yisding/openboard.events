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

Use the `status` operation for a read-only snapshot. It records the apex reporting policy, report
URI, Cloudflare's approved-source inventory, whether the first aggregate report has arrived, and
the sender-subdomain policy observed independently through Cloudflare and Google public DNS.
`policy` in the Cloudflare API result describes `_dmarc.openboard.events`; do not mistake it for
the enforced `_dmarc.mail.openboard.events` policy. The `fromDomainPolicy` field is the latter,
and the operation fails when the public resolvers disagree.
Cloudflare dashboard → **Email → DMARC Management** owns the per-source pass/fail detail; inspect
**View reports** and **View all** before approving any enforcement step.

## Live rollout record

Aggregate reporting was enabled at `2026-08-15T03:40:22Z` by protected workflow
[run 31862396508](https://github.com/yisding/openboard.events/actions/runs/31862396508) on
main commit `a0fd73be`. The operation returned `changed: true`, `reportingConfigured: true`,
`policy: none`, and an empty approved-source inventory. Cloudflare and Google public DNS both
resolved the resulting single apex record with Cloudflare's generated `rua` immediately after
the operation.

The original rollout plan started a seven-day reporting dwell at that timestamp. After the sender
inventory and receiver probes below showed that Resend is the only legitimate path for the exact
From domain, the repository/zone owner explicitly approved skipping the percentage stages. At
`2026-08-15T04:36Z`, an authenticated Cloudflare CLI operation published this sender-subdomain
record with a 300-second TTL:

```text
_dmarc.mail.openboard.events TXT "v=DMARC1; p=quarantine; pct=100; rua=mailto:<Cloudflare aggregate-report address>;"
```

The operation changed neither the apex reporting policy nor unrelated apex-domain mail. The exact
record was observed through Cloudflare and Google public resolvers immediately afterward. This is
an owner-approved compression of the earlier plan, not evidence that the skipped dwell occurred.

Resend Receiving verified the priority-10 `mail.openboard.events` MX to
`inbound-smtp.us-east-1.amazonaws.com` at `2026-08-15T05:07Z`. A fresh provider-level message to
`hello@mail.openboard.events` appeared in the Receiving feed at `2026-08-15T05:08Z`, proving the
reply mailbox route independently of the application outboxes. The `send.mail.openboard.events`
bounce/complaint MX remained unchanged.

At `2026-08-15T03:50Z`, the production speaker-portal path queued one test message for an
authorized Gmail recipient and one for an authorized Outlook.com recipient. Both requests
returned `200`, the durable outbox drained, and the health check showed no new failed message.
The recipient-provided authentication results established the expected path without retaining
addresses, message identifiers, signatures, or bearer links:

- Gmail reported aligned Resend DKIM for `mail.openboard.events`, SPF for
  `send.mail.openboard.events`, and `dmarc=pass` under the current `p=none` policy. It placed the
  message in Inbox.
- Outlook reported the same aligned DKIM, SPF, and `dmarc=pass`, plus `compauth=pass`. It placed
  the message in Junk despite those passes.

Gmail Inbox and Outlook Junk are the pre-enforcement placement baseline. The Outlook decision was
not a DMARC policy action: the message passed DMARC while the policy was `p=none`. Repeat both tests
under full quarantine before reject, comparing authentication and folder placement. A worse result
or any authentication regression blocks promotion; an unchanged Outlook Junk result remains a
separate sender-reputation/content issue and must not be presented as proof that DMARC caused it.

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
| reporting (`p=none`) | reporting configured; test mail shows `dmarc=pass` | superseded by the owner-approved compressed rollout on 2026-08-15 |
| quarantine 10% | planned but skipped; no claim of completed dwell | not applicable |
| quarantine 50% | planned but skipped; no claim of completed dwell | not applicable |
| quarantine 100% | Resend confirmed as the only From-domain sender; Gmail and Outlook both passed aligned DMARC | 48 hours and two aggregate-report periods from independent receivers |
| reject 100% | zero unidentified legitimate senders and zero legitimate failures at full quarantine | permanent; review weekly |

The skipped percentage stages would have reduced exposure, but receivers are allowed to ignore
`pct` anyway. Full quarantine is now live; never infer that the historical 10% and 50% gates were
completed. Retain all authentication, report, and placement gates before reject.

Record Inbox/Junk placement with every Gmail and Outlook probe so delivery changes can be
compared with the pre-enforcement baseline. Authentication results determine DMARC alignment;
folder placement is the separate regression signal. A receiver without a recorded baseline blocks
promotion until one is captured.

For the calendar-specific receiver gate, manually run **Production mail delivery probe**, type
`production` in its confirmation input, and provide one authorized Gmail address and one authorized
Outlook address. The protected production job creates
one temporary published session through the agenda mutation layer, waits for provider acceptance
of the initial REQUEST and a rescheduled REQUEST, removes both speakers and waits for CANCEL, then
deletes the session. A failed run also hard-deletes the temporary session so any already-accepted
REQUEST receives a durable cancellation. The workflow proves application/outbox/provider behavior;
it does not infer inbox placement. Inspect all three messages at both receivers and record their
folder/calendar behavior and authentication headers separately.

## Monitoring and rollback

Stop or roll back one stage immediately when any of these occurs:

- one legitimate source or message fails DMARC;
- a passing source is not Resend/Amazon SES and has not been explicitly approved;
- Gmail or Outlook placement worsens relative to the reporting-stage baseline;
- production delivery failures or bounces rise above the alerting runbook's existing threshold;
- SPF or DKIM DNS no longer resolves, Cloudflare reports a DMARC configuration status, or the
  application From domain changes.

Rollback changes only `_dmarc.mail.openboard.events`, using the preceding stage's exact record.
DNS TTL is 300 seconds; verify authoritative DNS and two public resolvers within 10 minutes. If
reject is active and legitimate mail is failing, roll directly back to `p=none`, preserve the
Cloudflare `rua`, and treat the sending path as an incident. Never disable aggregate reporting
during rollback.

The protected repository token intentionally cannot edit DNS. Policy mutation requires an
owner-approved, authenticated Cloudflare DNS operation; the protected **DMARC operations** status
run is the independent post-change evidence. Do not broaden the reporting token to combine these
roles.

After every change, verify:

1. `_dmarc.openboard.events` and `_dmarc.mail.openboard.events` return one valid TXT record each.
2. `send.mail.openboard.events` resolves the Resend/Amazon SES SPF and return-path MX records.
3. `resend._domainkey.mail.openboard.events` resolves DKIM.
4. A production message delivered to Gmail and Outlook has `dmarc=pass` in its authentication
   results, and its Inbox/Junk placement is recorded against the reporting-stage baseline.
