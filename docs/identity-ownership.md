# Identity ownership and linking

OpenBoard deliberately has three person-shaped records. They have different
trust, tenancy, and erasure boundaries, so sharing an email address is evidence
for a relationship, never permission to collapse them.

| Identity | Owner and creation authority | Canonical email and credentials | Consent / suppression | Merge, erasure, and audit |
| --- | --- | --- | --- | --- |
| Product user (`users`) | Admin auth creates an account through signup, OAuth, an accepted organization/event invitation, or the bootstrap command. Organization and event membership grant authorization; they do not create a second product identity. | Database constraints require `lower(btrim(email))` and global uniqueness. Better Auth owns password/social credentials and admin sessions. | Legal acceptances and platform-auth mail belong to product auth. Event marketing consent is never inferred from the account. | Deleting the user cascades credentials, sessions, memberships, and user-contact links. Organization audit owns membership/invitation actions. Product users are not merged with portal identities. |
| Event contact (`contacts`) | The event-contacts feature is the only field writer. CFP submission, speaker roster/import, portal auth, CRM push, and reviewer-contact provisioning call its canonical upsert/patch contract. | Email is canonical and unique within one event. Portal OTP/magic-link tokens and sessions authenticate this identity independently of admin auth. | `contacts.unsubscribed_at` and provider `contact_suppressions` are authoritative for event mail. A linked product user does not bypass them. | Contact erasure owns event-scoped deletion/export; composite foreign keys remove portal/comms/link rows. There is no event-contact merge operation. Communication logs and erasure receipts own the relevant audit trail. |
| Organization CRM contact (`organization_contacts`) | CRM creates manual/imported prospects and event-sync identities inside one organization. `organization_contact_links` explicitly connects them to event contacts. | Email is canonical and unique only within one organization. It is not a login identifier. | CRM bulk mail resolves through event contacts, so the event contact's unsubscribe/suppression state remains authoritative. | CRM owns primary/duplicate merge, immutable merge audit, recovery, and optional organization-profile erasure. A merge rewrites CRM links but does not rewrite a product-user link to the surviving event contact. |

## Stable relationship rules

`user_contact_links` is the sole product-user to event-contact relationship.
It is one-to-one inside an event, is constrained to an existing event member
and contact in that same event, and records why the relationship was made:
`backfill`, `invitation`, `reminder`, or `operator`.

`organization_contact_links` remains the sole CRM-to-event relationship. It is
many event contacts to one organization identity and is scoped by organization
and event composite foreign keys. Neither link grants credentials or roles.

Runtime consumers call the event-contacts resolver, which has exactly three
outcomes:

- `linked`: a durable `user_contact_links` row supplies the contact id;
- `unlinked`: no durable row exists, with at most one unclaimed candidate that
  a business action may explicitly link;
- `ambiguous`: candidate evidence disagrees or the candidate is already owned
  by another product user; the caller must not guess or send as that contact.

Email comparison is allowed only inside explicit creation/link resolution and
the audited migration. Shared-email reads are not identity joins. Changing a
product email does not silently mutate a speaker profile, changing a speaker
email does not change admin credentials, and neither change rewires a stable
link.

## Backfill and rollout

Migration `0041_stable_user_contact_links.sql` builds candidate sets from the
canonical event email and existing stable CRM link. Exactly one candidate is
linked. Zero candidates remain unlinked. Multiple candidates are quarantined
as `ambiguous`; no link is written.

Every existing event membership gets a PII-free row in
`user_contact_link_backfill_audit`, containing only stable ids, outcome, and
time. Before switching a consumer, operators must report:

```sql
SELECT outcome, count(*)
FROM user_contact_link_backfill_audit
GROUP BY outcome
ORDER BY outcome;
```

Ambiguous rows are reviewed by joining their ids to current records. Resolution
creates one `source = 'operator'` link; the original audit row remains unchanged
as the migration-time record. Application rollout is additive schema, dual
write/dual read, stable read, then removal of the legacy email join. Rollback is
the reverse application order; the additive tables stay until no deployed
version writes them.

## Boundary scenarios

- Invitation acceptance may provision and link an event contact, but it never
  creates a portal session or copies an admin credential.
- Reviewer reminders must resolve a stable contact before enqueue. Delivery
  still evaluates that contact's unsubscribe and provider suppression state.
- CRM merge leaves a product-user link stable because it targets the event
  contact, not either CRM row.
- Event-contact erasure cascades the user-contact link while leaving the product
  account intact. Product-account deletion removes the link while leaving the
  independently governed event contact for its own retention/erasure process.
