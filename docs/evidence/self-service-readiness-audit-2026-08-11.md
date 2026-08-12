# Self-service signup and onboarding readiness — 2026-08-11

Scope: the first-user journey from `/signup` or an organization invitation to a
shareable call-for-speakers link, using the production Worker configuration and
the real database-backed surfaces.

## Journey map

| Stage | Current path | Readiness |
|---|---|---|
| Account creation | `/signup` → check inbox → verify email → sign in | Functional; session creation is blocked until the address is verified |
| Invitation signup | `/join?token=…` → `/signup?next=…` | Token-bound in this slice; email matching alone no longer grants membership |
| Organization creation | Better Auth user hook → organization + owner + free entitlement | Functional; signup now collects the intended organization name |
| First event | `/organizations/<id>/onboarding` step 1 | Functional and tenant-scoped |
| First tracks | onboarding step 2 | Functional and explicitly optional |
| First CFP | onboarding step 3 → create/publish form | Functional and retry-aware while the page remains open |
| First value | onboarding step 4 → copy public submission link | Functional |

## Closed in this slice

- Removed the email-only invitation lookup. A signup must possess the raw,
  unexpired invitation token and use the address the token was issued to.
- Validate invitation credentials before inserting the Better Auth user, then
  atomically claim the invitation and upsert membership.
- Clean up the newly inserted auth user if organization provisioning fails;
  credential and social-account rows cascade with it.
- Carry the accepted organization id back to the signup client so a new invitee
  lands directly in the invited workspace without creating an unwanted personal
  organization or visiting the invitation twice.
- Ask ordinary signups for their organization name and use it for the initial
  organization and slug.
- Send an existing-account signup failure back to login with the intended
  destination preserved.
- Make invitation acceptance continue to the organization instead of sending an
  already-authenticated user back to login.
- Add a non-mutating post-deploy probe for Better Auth, plus integration coverage
  for wrong-address rejection, token consumption, role assignment, organization
  naming, and destination propagation.

## Closed in follow-up slices — updated 2026-08-12

- Added durable onboarding checkpoints and recovery so refreshes, sign-outs,
  stable-id retries, and lost mutation responses resume the same event rather
  than creating a duplicate.
- Added a persistent dashboard activation guide that carries an organizer from
  an absent/draft/scheduled/live form to the first public submission.
- Completed the post-setup handoff with a direct form preview, resilient link
  copying, and a dismissible first-submission milestone that opens the proposal
  drawer for review.
- Added product-level, encrypted, retryable authentication mail that works
  before an event exists. Password signup now requires verified email control,
  with check-inbox, resend, expired-link, and unverified-sign-in states.
- Moved eventless password recovery onto the same platform auth outbox.
- Added shared database-backed limits for signup, verification resend, and
  password-reset requests; provider-isolate limits are now defense in depth.
- Simplified the first-event wizard around customer language and defaults:
  browser-local timezone selection, an optional collapsed URL customization,
  plain-language Tracks/Share steps, visible completed-step state, and a
  compact single-card layout on desktop and mobile.

## Remaining launch gaps, in priority order

1. **End-to-end first-user proof.** The browser journey now creates a fresh
   account through public signup, waits for Resend to report the exact outbox
   message delivered to a controlled allowlisted address, follows its real
   verification link, signs in, names and provisions the organization, creates
   an event and optional tracks, publishes a form, and opens the returned link
   in an unauthenticated browser. The preview mailbox variable is configured; the
   remaining deployment action is to install the protected, read-capable
   `E2E_RESEND_API_KEY` secret and record the first deployed green run before
   production promotion.
2. **Launch consent.** Signup, verification, first event, first form publication,
   and first open-form visit now produce one privacy-safe, first-occurrence
   milestone per organization. The remaining legal action is to have Terms and
   Privacy text reviewed, publish it, link it from signup, and record the
   accepted versions; the repository drafts explicitly prohibit product use
   before business/counsel approval.
3. **Traffic-dependent bot defense.** Shared atomic limits now protect the
   public auth mail endpoints. Add a challenge only if launch traffic shows that
   rate limits alone are insufficient; it is no longer a correctness blocker.

Billing remains deliberately outside this journey while the provider is a
disabled scaffold. Reaching first value means publishing a working CFP link; it
must not depend on checkout or operator provisioning.
