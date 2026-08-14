-- Public submission codes are collision-resistant identifiers, not ordering
-- keys. Support stable API keyset pagination by the row's durable creation
-- position while retaining code as the externally compatible cursor token.
CREATE INDEX submissions_event_created_id_idx
  ON submissions (event_id, created_at, id);
