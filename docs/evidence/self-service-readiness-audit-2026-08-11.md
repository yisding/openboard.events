# Self-service signup and onboarding readiness — 2026-08-11

Scope: the first-user journey from `/signup` or an organization invitation to a
shareable call-for-speakers link, using the production Worker configuration and
the real database-backed surfaces.

## Journey map

| Stage | Current path | Readiness |
|---|---|---|
| Account creation | `/signup` → Better Auth email signup → sign in | Functional; deployed auth mounting is smoke-tested |
| Invitation signup | `/join?token=…` → `/signup?next=…` | Token-bound in this slice; email matching alone no longer grants membership |
| Organization creation | Better Auth user hook → organization + owner + free entitlement | Functional; signup now collects the intended organization name |
| First event | `/organizations/<id>/onboarding` step 1 | Functional and tenant-scoped |
| First vocabulary | onboarding step 2 | Functional; optional tracks |
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

## Remaining launch gaps, in priority order

1. **Verified email activation.** `emailVerification.sendOnSignUp` is off because
   admin auth mail currently needs an event-scoped outbox row, while a new
   organization has no event. General signup therefore does not yet prove control
   of the address. Add a platform-level transactional auth-mail path, require
   verification before sign-in, and provide resend/expired-link UI.
2. **Durable onboarding resume.** The wizard keeps its event, step, tracks, and
   form in client state. Reloading after event creation restarts at step 1 and can
   lead a user to create a second event. Derive progress from server state and
   resume at the first incomplete step.
3. **End-to-end first-user proof.** Add a browser test that creates a unique
   account, names its organization, creates an event and form, publishes it, and
   opens the returned public link. Run the same flow against preview with a
   controlled test mailbox before production promotion.
4. **Durable signup abuse controls.** Better Auth's current deployed limiter is
   isolate-local memory. Back signup and verification sends with a shared,
   atomic limit (and add bot protection if public traffic warrants it).
5. **Recovery before first event.** Password-reset email is skipped for an
   account with no event membership, so a user who loses access during the first
   setup cannot recover without support. The platform auth-mail path must cover
   this case too.
6. **Launch consent and product signals.** Link reviewed Terms and Privacy text
   from signup, record the accepted versions, and emit funnel events for signup,
   verification, event creation, form publication, and first public visit.

Billing remains deliberately outside this journey while the provider is a
disabled scaffold. Reaching first value means publishing a working CFP link; it
must not depend on checkout or operator provisioning.
