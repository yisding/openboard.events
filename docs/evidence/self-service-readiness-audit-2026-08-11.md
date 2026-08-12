# Self-service signup and onboarding readiness — 2026-08-11

Scope: the first-user journey from `/signup` or an organization invitation to a
shareable call-for-speakers link, using the production Worker configuration and
the real database-backed surfaces.

## Journey map

| Stage | Current path | Readiness |
|---|---|---|
| Account creation | `/signup` → check inbox → verify email → workspace | Functional; session creation is blocked until the address is verified, then the confirmation link continues directly into the provisioned workspace |
| Invitation signup | `/join?token=…` → `/signup?next=…` | Token-bound in this slice; email matching alone no longer grants membership |
| Organization creation | Better Auth user hook → organization + owner + free entitlement | Functional; signup now collects the intended organization name |
| First event | `/organizations/<id>/onboarding` step 1 | Functional and tenant-scoped |
| First tracks | onboarding step 2 | Functional and explicitly optional |
| First CFP | onboarding step 3 → create/publish form | Functional and retry-aware across refreshes and lost completion responses |
| First value | onboarding step 4 → copy public submission link → receive first proposal | Functional; the exact completed event/form handoff survives reload, the generated form omits unanswerable empty choice controls, and the dashboard acknowledges the first submitted proposal |

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
- Removed the redundant sign-in after mailbox confirmation. The short-lived
  verification link now opens a scanner-safe confirmation page; only the
  customer's explicit POST establishes the first session, then the handoff
  sends them directly into the provisioned workspace. Old or replayed links
  retain a normal sign-in fallback.
- Made the final onboarding handoff durable. The browser records the exact
  event in the URL before completing its checkpoint; a reload authorizes that
  event and restores the same form, public link, and next actions instead of
  accidentally starting another event. Draft and closed forms now lead
  directly to the exact form builder rather than an unrelated settings page.
- Kept empty optional vocabulary questions in the form builder for later
  configuration without rendering dead Format, Track, or Tags controls to
  speakers before those questions have choices.
- Extended the protected first-user journey beyond opening the public link: it
  retrieves the real portal OTP from Resend, submits the generated form, proves
  the stored SESS reference, and verifies that the organizer dashboard replaces
  its launch guide with the first-submission acknowledgment.
- Dispatches public CFP verification codes immediately after their durable
  enqueue, so a first speaker does not wait for the next one-minute outbox cron;
  the cron remains the retry guarantee.
- Made self-service account creation discoverable from the public landing page
  and sign-in screen. Switching between signup, sign-in, and password recovery
  now preserves a validated invitation/workspace destination through the reset
  email round-trip without retaining its nested bearer token in mail history.

## Remaining launch gaps, in priority order

1. **End-to-end first-user proof.** The browser journey now creates a fresh
   account from the public landing page through signup, waits for Resend to report the exact outbox
   message delivered to a controlled allowlisted address, follows its real
   verification link into the signed-in workspace, names and provisions the
   organization, creates an event and optional tracks, publishes a form, follows
   the returned link in an unauthenticated browser, completes the real speaker
   OTP flow, submits a proposal, and observes it back in the organizer dashboard.
   The preview mailbox variable is configured; the
   remaining deployment action is to install the protected, read-capable
   `E2E_RESEND_API_KEY` secret and record the first deployed green run before
   production promotion.
2. **Launch consent activation.** The signup UI and server now require the exact
   configured Terms and Privacy versions, reject missing or stale acceptance,
   and retain an immutable, privacy-minimal acceptance record. The feature stays
   dormant when the complete four-value policy set is absent so unapproved
   drafts are never exposed and the current deployment remains operable. The
   remaining legal action is to have Terms and Privacy text reviewed, publish
   it, and configure both URLs and stable versions; the repository drafts
   explicitly prohibit product use before business/counsel approval.
3. **Traffic-dependent bot defense.** Shared atomic limits now protect the
   public auth mail endpoints. Add a challenge only if launch traffic shows that
   rate limits alone are insufficient; it is no longer a correctness blocker.

Billing remains deliberately outside this journey while the provider is a
disabled scaffold. Reaching first value means publishing a working CFP link; it
must not depend on checkout or operator provisioning.
