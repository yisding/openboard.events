# Privacy policy

> **STATUS: DRAFT — not reviewed by counsel, not published, not binding.**
> This is a structural stub written alongside the M47 (data lifecycle & GDPR)
> engineering work so the document's sections match what the product actually
> does — which data it holds, where, and for how long — rather than being
> drafted from a generic template. It must be reviewed by counsel and
> approved by the business owner before it is linked from any real signup,
> checkout, or footer surface. Placeholders are marked `[TODO: ...]`.

**Last updated:** [TODO: date of legal review] · **Effective date:** [TODO]

## 1. Who this covers

Openboard ("we", "us") operates event-management software used by
organizations ("customers", "you") to run calls for speakers, review
submissions, build a schedule, and communicate with speakers. This policy
describes:

- data we collect about **customers** (the organizers who sign up and use
  the product), and
- data our customers collect about **contacts** (speakers, co-speakers, and
  reviewers) through the product, which we process **on the customer's
  behalf** as a data processor, not as the data controller for that data.

[TODO: confirm controller/processor split with counsel — this stub assumes
the standard SaaS posture (customer is controller of their event's contact
data, we are processor) but that must be stated correctly, including any
Data Processing Addendum reference — see `dpa.md`.]

## 2. What we collect

| Category | Examples | Where it lives |
|---|---|---|
| Account data | Name, email, password hash (or OAuth identity), organization membership | `users`, `organization_members` |
| Event/organization data | Event name, dates, branding, team roles | `events`, `organizations` |
| Contact (speaker) data | Name, email, bio, headshot, social links, submitted talk content, logistics answers, uploaded files | `contacts` and its dependent tables — see §4 |
| Communications | Emails sent through the product (subject/body/status), calendar invites | `communication_logs`, `calendar_invites` |
| Usage/security data | Sign-in sessions, portal login tokens, rate-limit counters, and one timestamp for each completed self-service onboarding milestone | `admin_sessions`, `portal_sessions`, `portal_tokens`, `rate_limit_buckets`, `admin_login_attempts`, `organization_onboarding_milestones` |

The onboarding milestone table is server-side and organization-scoped. It
stores only the first occurrence of five fixed milestones, with no email, IP
address, user agent, URL, or arbitrary event metadata; deleting the
organization deletes its milestone history. [TODO: add cookies/client analytics
disclosure once/if any client-side analytics is added — none is integrated as
of this draft.]

## 3. Why we collect it

To operate the product: authenticate users, run the call-for-speakers and
review workflow, build and publish a schedule, send the emails and calendar
invites an event organizer configures, and enforce basic abuse controls
(rate limiting, suppression of bouncing addresses). [TODO: add legal basis
per category once counsel has reviewed — likely contract performance for
account/event data, and controller-instructed processing for contact data.]

## 4. How long we keep it

- **Expired authentication tokens and sessions** (`portal_tokens`,
  `admin_sessions`, `admin_verifications`, `portal_sessions`): purged
  automatically 30 days after expiry by the daily retention job
  (`src/features/data-lifecycle/server/retention.ts`, wired into
  `/api/jobs/cleanup`).
- **Rate-limit and sign-in-throttle counters** (`rate_limit_buckets`,
  `admin_login_attempts`): purged automatically by the same daily job 7 days
  after the last request counted against them. These rows hold a one-way
  hash of the caller key (an IP address, or an email address plus IP for the
  sign-in throttle) and a request count — never the value itself.
- **Rendered email content** (`communication_logs.subject_rendered` /
  `.body_rendered_html`): redacted automatically 90 days after send; the
  audit metadata (who, when, template, delivery status) is retained
  indefinitely for deliverability reporting.
- **Contact/speaker data**: retained for the life of the event and the
  organizer's account, or until a right-to-erasure request is fulfilled
  (§6), whichever is sooner. [TODO: set a default retention period for
  past/completed events with counsel — this stub currently has no
  auto-expiry for accepted-speaker or program data, matching that organizers
  reasonably need to keep a record of who spoke at their event.]

## 5. Who we share it with

[TODO: list sub-processors — at minimum: Neon (database hosting), Cloudflare
(application hosting/CDN), Resend (transactional email delivery), and
Airtable if a customer opts into the Airtable sync integration. Each needs
its own data-processing terms referenced here.]

## 6. Your rights

Depending on your jurisdiction (GDPR/UK GDPR, CCPA/CPRA, and similar), you
may have the right to access, correct, export, or delete personal data held
about you.

- **Access/export**: an organizer can export a JSON bundle of a contact's
  data via the admin speaker record ("Export data"), or a data-subject
  request can be routed to [TODO: support/privacy contact address].
- **Erasure**: an organizer can permanently delete a contact's data via the
  admin speaker record ("Delete contact"), which deletes, in one atomic
  operation, every row that references that contact within the event
  (submitted answers, uploaded files, comms history, portal sessions) *and*
  the organization-level speaker-CRM profile that event contact is linked to
  — or, if it was never linked, the profile held under the same email address
  in that organization — including its profile fields, notes, activity
  timeline, tags, pipeline entries, merge snapshots and any duplicate records
  previously merged into it. That second, organization-wide part is deleted
  when the organizer also holds rights over the organization the event belongs
  to, since one such profile is shared across all of that organization's
  events; an organizer of the event alone deletes the event's record only. See
  `src/features/data-lifecycle/server/contact-erasure.ts` for the exact
  scope of what is deleted versus anonymized (e.g. a submission a deleted
  speaker co-authored survives as an organizational record, with its
  attribution to that person removed).

  One limit is worth stating plainly: erasure is performed per *event*
  contact. If the same person is separately a contact of another event, that
  event's record of them is a distinct identity and needs its own erasure
  request — the CRM profile is removed once, by the first such request made by
  an organizer who also holds organization-level rights.

[TODO: add the self-service path for a *contact* (not an organizer) to
request erasure of their own data directly, rather than only through the
event organizer — current implementation is organizer-initiated only.]

## 7. Contact

[TODO: privacy contact email/address, and the identity of the data
controller entity once incorporated/finalized.]
