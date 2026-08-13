-- Keep committee scoring independent by default. Existing rounds previously
-- exposed the live aggregate to reviewers; preserving that behaviour for
-- already-configured rounds avoids changing an active committee mid-round.
-- Newly created rounds use the schema/default false unless an organizer
-- explicitly enables collaborative score sharing.

ALTER TABLE evaluation_plans
  ADD COLUMN show_peer_scores boolean NOT NULL DEFAULT false;

UPDATE evaluation_plans
SET show_peer_scores = true;
