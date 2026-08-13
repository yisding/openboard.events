# Submission checklist

Wednesday Aug 12. **Submit by 8:00 PM PT** — the two hours before the 10 PM deadline are the
deliberate buffer against an upload or form failure, not extra build time.

Written early on purpose: every item here is pure verification, and verification is what gets
squeezed when the last day runs long.

## Feature freeze — 2:00 PM PT (CP4)

Anything not merged at this point is cut. Branch protection then narrows to bug fixes, copy and
seed changes only.

- [ ] All six Playwright specs green against `sb-test`, with no `test.skip` left in `cfp-submit`
- [x] 50-concurrent submit load test run — 50/50 `200`, p95 27703 ms, recorded in `DECISIONS.md`
- [ ] Perf pass: cache headers verified, Worker gzip within budget, Neon scale-to-zero off,
      dashboard served by a single endpoint
- [ ] Production email re-verified: `EMAIL_MODE=send`, allowlist unset, `EMAIL_FALLBACK_UI=0`,
      sending domain green with aligned SPF/DKIM/DMARC
- [ ] Seed v3 matches what the walkthrough videos show

## The repository

- [ ] Repository is public
- [ ] `LICENSE` present (MIT)
- [ ] `docs/development.md` setup followed on a **clean clone by someone who did not write it**, reaching a
      seeded local app — not read, actually run
- [ ] `docs/development.md`'s honest-status section matches reality on the day, including anything cut
- [ ] `docs/demo-script.md` complete, with admin, reviewer and speaker credentials
- [ ] `docs/api.md` examples paste-and-run against production
- [ ] `docs/spend/` holds one usage export per agent per day

## The deployment

- [ ] Production migrated, deployed, and healthy
- [ ] `bash scripts/post-deploy-smoke.sh <prod> --production` exits 0 — including that
      `/api/test/login` 404s, which is what proves `TEST_AUTH` is absent from the production build
- [ ] `wrangler rollback` rehearsed against production at least once, and the command written down
- [ ] Neon PITR rehearsed against `sb-dev` at least once (`docs/runbooks/pitr-rehearsal.md`), with
      the run recorded in `DECISIONS.md`
- [ ] Cron tick observed in the production tail
- [ ] Communications log clean: no failed rows, no duplicate sends
- [ ] Final seed reset run (`pnpm seed --wipe` with `SEED_ALLOW_PROD=1`) — after the last rehearsal,
      before judging

## The judge's cold run

Someone who did not build the feature walks `docs/demo-script.md` end to end, on production, from
a fresh browser:

- [ ] All nine primary features reachable and demoable unassisted
- [ ] OTP round-trip to **one fresh Gmail and one fresh Outlook address**, typed into the CFP
      wizard exactly as a judge would — first-contact inboxes are where spam and DMARC treatment
      differs from the warmed team inboxes used earlier in the week
- [ ] A portal magic link and a decision email land on the same two inboxes
- [ ] A calendar invite lands on the fresh Gmail's calendar from a real scheduling action
- [ ] The CFP wizard completed once on an actual phone, not a resized window

## Submitting

- [ ] Submission form filled, with the production URL and the repository link
- [ ] Walkthrough recording attached (optional, only if it costs nothing at this point)
- [ ] Reimbursement evidence compiled from `docs/spend/`
- [ ] **Submitted by 8:00 PM PT**
- [ ] 8–10 PM: emergencies only. A P0 fix ships; nothing else does.
