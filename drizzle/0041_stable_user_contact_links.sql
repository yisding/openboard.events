-- Stable product-user <-> event-contact identity.
--
-- Forward recovery: this migration is additive. It records every existing
-- event membership in `user_contact_link_backfill_audit`, creates links only
-- for a single unambiguous candidate, and leaves zero/multiple-candidate rows
-- untouched. Operators can inspect the PII-free report by outcome and create
-- an explicit `source = 'operator'` link after resolving an ambiguous row.
-- Re-running either final INSERT is safe through its primary-key conflict
-- guard. Rollback is application-first: keep both tables through the dual-read
-- window, revert consumers, then drop these additive tables only after no
-- deployed version writes them.

CREATE TABLE user_contact_links (
  user_id uuid NOT NULL,
  event_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id),
  CONSTRAINT user_contact_links_event_contact_uq UNIQUE (event_id, contact_id),
  CONSTRAINT user_contact_links_member_fk
    FOREIGN KEY (user_id, event_id) REFERENCES event_members(user_id, event_id) ON DELETE CASCADE,
  CONSTRAINT user_contact_links_contact_fk
    FOREIGN KEY (contact_id, event_id) REFERENCES contacts(id, event_id) ON DELETE CASCADE,
  CONSTRAINT user_contact_links_source_ck
    CHECK (source IN ('backfill', 'invitation', 'reminder', 'operator'))
);

CREATE TABLE user_contact_link_backfill_audit (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  outcome text NOT NULL,
  candidate_contact_ids uuid[] NOT NULL DEFAULT '{}',
  linked_contact_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id),
  CONSTRAINT user_contact_link_backfill_outcome_ck
    CHECK (outcome IN ('linked', 'unlinked', 'ambiguous')),
  CONSTRAINT user_contact_link_backfill_shape_ck CHECK (
    (outcome = 'linked' AND cardinality(candidate_contact_ids) = 1 AND linked_contact_id = candidate_contact_ids[1])
    OR (outcome = 'unlinked' AND cardinality(candidate_contact_ids) = 0 AND linked_contact_id IS NULL)
    OR (outcome = 'ambiguous' AND cardinality(candidate_contact_ids) > 1 AND linked_contact_id IS NULL)
  )
);
CREATE INDEX user_contact_link_backfill_outcome_idx
  ON user_contact_link_backfill_audit(outcome, event_id);

-- Candidate authority is deliberately narrow and auditable:
--   1. the event contact with the product user's canonical email, and
--   2. an event contact already linked to the same-email CRM identity in the
--      event's organization.
-- A changed event-contact email can make those two stable candidates differ;
-- that is a real ambiguity and is quarantined instead of guessed away.
WITH candidates AS (
  SELECT membership.user_id, membership.event_id, contact.id AS contact_id
  FROM event_members membership
  JOIN users account ON account.id = membership.user_id
  JOIN contacts contact
    ON contact.event_id = membership.event_id AND contact.email = account.email
  UNION
  SELECT membership.user_id, membership.event_id, link.contact_id
  FROM event_members membership
  JOIN users account ON account.id = membership.user_id
  JOIN events event ON event.id = membership.event_id
  JOIN organization_contacts organization_contact
    ON organization_contact.organization_id = event.organization_id
   AND organization_contact.email = account.email
   AND organization_contact.merged_into_id IS NULL
  JOIN organization_contact_links link
    ON link.organization_id = event.organization_id
   AND link.organization_contact_id = organization_contact.id
   AND link.event_id = membership.event_id
), summarized AS (
  SELECT
    membership.user_id,
    membership.event_id,
    COALESCE(
      array_agg(candidate.contact_id ORDER BY candidate.contact_id)
        FILTER (WHERE candidate.contact_id IS NOT NULL),
      '{}'::uuid[]
    ) AS candidate_contact_ids
  FROM event_members membership
  LEFT JOIN candidates candidate
    ON candidate.user_id = membership.user_id AND candidate.event_id = membership.event_id
  GROUP BY membership.user_id, membership.event_id
)
INSERT INTO user_contact_link_backfill_audit (
  user_id, event_id, outcome, candidate_contact_ids, linked_contact_id
)
SELECT
  user_id,
  event_id,
  CASE cardinality(candidate_contact_ids)
    WHEN 0 THEN 'unlinked'
    WHEN 1 THEN 'linked'
    ELSE 'ambiguous'
  END,
  candidate_contact_ids,
  CASE WHEN cardinality(candidate_contact_ids) = 1 THEN candidate_contact_ids[1] END
FROM summarized
ON CONFLICT (user_id, event_id) DO NOTHING;

INSERT INTO user_contact_links (user_id, event_id, contact_id, source)
SELECT user_id, event_id, linked_contact_id, 'backfill'
FROM user_contact_link_backfill_audit
WHERE outcome = 'linked' AND linked_contact_id IS NOT NULL
ON CONFLICT DO NOTHING;
