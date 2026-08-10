# Data Processing Addendum (DPA)

> **STATUS: DRAFT — not reviewed by counsel, not published, not binding, not
> yet a signable document.** Structural stub only, written to match the
> actual data flows in this codebase (§3–§5) so a real DPA can be drafted
> from an accurate technical description rather than a generic template.
> `[TODO: ...]` marks anything that needs a legal/business decision.

**Between:** Openboard ("Processor") and Customer ("Controller"), as an
addendum to the Terms of Service (`terms-of-service.md`).

## 1. Subject matter and duration

Processor processes personal data on Controller's behalf to provide the
Service (event management: call-for-speakers, review, scheduling, speaker
portal, and templated communications) for the duration of the underlying
Terms of Service. [TODO: counsel to confirm this framing and add the
required GDPR Art. 28(3) enumerated terms this stub does not yet cover in
full — subject matter, duration, nature/purpose, type of personal data,
categories of data subjects, and Controller's obligations/rights.]

## 2. Categories of data subjects and personal data

- **Data subjects**: event speakers, co-speakers, and reviewers that
  Controller's team enters into the Service (the `contacts` table, scoped
  per event).
- **Personal data categories**: name, email, job title/company, biography,
  headshot, social/website links, submitted talk content and logistics
  answers, uploaded files (slides, attachments), communications sent to
  them, and authentication metadata (portal session/token timestamps —
  never the raw token itself, which is stored only as a hash).

## 3. Processing instructions

Processor processes personal data only:

1. to provide the Service per Controller's configuration (forms, review
   rounds, schedule, templated emails Controller authors or selects), and
2. as required to comply with applicable law, and
3. as documented in this DPA or a signed Order Form.

Processor does not sell personal data or use it for its own advertising
purposes. [TODO: counsel to add the full Art. 28(3)(a) instruction clause.]

## 4. Sub-processors

[TODO: same list as `privacy-policy.md` §5 — Neon, Cloudflare, Resend, and
conditionally Airtable — each needs a name, purpose, and data location.
Keep the two documents in sync when this list changes.]

## 5. Data subject rights assistance

Processor provides the following tooling so Controller can fulfill a data
subject request without engineering support once a request is received:

- **Access/portability** (`GET /api/internal/speakers/{eventId}/{contactId}/export`,
  organizer-authenticated): a JSON bundle of everything the Service holds
  about one contact — profile, submissions and their submitted answers,
  portal tasks, roster/logistics answers, uploaded-file metadata,
  communications sent (including rendered content, before the 90-day
  retention window redacts it), calendar invites, and authentication
  metadata (timestamps only — never token/OTP hashes).
- **Erasure** (`DELETE /api/internal/speakers/{eventId}/{contactId}`,
  organizer-authenticated): permanently deletes the contact and every row
  that references it — submitted answers, roster data, uploaded files
  (including the underlying object storage), comms history, portal
  sessions/tokens — together with the organization-level speaker-CRM profile
  that contact is linked to (profile fields, notes, activity timeline, tag
  links, pipeline entries and history, and merge snapshots), in one atomic
  operation; and anonymizes (rather than deletes) organizational records
  that reference the contact but are not themselves personal data, such as a
  submission's title/status surviving with its speaker attribution removed.
  Implementation: `src/features/data-lifecycle/server/contact-erasure.ts`;
  the exact set of tables touched is documented in that file's header
  comment and returned to the caller as a per-table deletion receipt.

  Scope limit: the unit of erasure is one contact *within one event*. Where
  the same data subject is also a contact of another event, that event's
  record is a separate identity and requires its own request; the shared
  organization-level CRM profile is erased by the first such request.
- **Organization-level export** (`GET /api/internal/organizations/{organizationId}/export`,
  organization-owner/organizer-authenticated): the organization's own
  administrative record — profile, team membership, pending invitations,
  audit log, and event directory.

[TODO: an organization-level *erasure* (full tenant deletion, e.g. on
account closure) is not yet implemented — only contact-level erasure exists
today. Add before offering "delete my account" as a self-service action.]

## 6. Retention and deletion on termination

Automatic retention limits currently enforced by the Service (independent of
any Controller-initiated erasure request):

- Expired authentication tokens/sessions: purged 30 days after expiry.
- Rendered email content: redacted 90 days after send (audit metadata kept).

[TODO: post-termination bulk deletion timeline — not yet implemented as an
automated flow; today, termination-time deletion would be a manual/support
operation using the per-contact erasure path above, repeated per contact.]

## 7. Security measures

[TODO: standard Art. 32 security-measures summary — encryption in transit
(TLS via Cloudflare), encryption at rest (Neon-managed), access controls
(role-scoped admin/organization auth), and incident-notification
commitments. Needs counsel + a real security review before publication, not
an engineering summary alone.]

## 8. International transfers

[TODO: data residency of Neon/Cloudflare/Resend and any required transfer
mechanism (SCCs, etc.) — depends on final sub-processor and hosting region
choices.]
