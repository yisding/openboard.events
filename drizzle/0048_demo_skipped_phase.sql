-- First Fair — remember where a skipped provision actually stopped.
--
-- "Continue without it" (design §2.8) CAS-jumps `provision_phase` straight to
-- `ready` so a half-built world is still a usable sandbox rather than a dead
-- end. That write destroyed the only record of how far the build got, which
-- made the promise the screen prints beside the button — "the parts that
-- needed this step will say so" — impossible to keep: the tour had no way to
-- know which chapters were pointing at an empty page.
--
-- A separate nullable column rather than a reinterpretation of
-- `provision_phase`: that column is the *cursor*, its CHECK constrains it, and
-- overloading it would make "ready" ambiguous for every reader. NULL means the
-- world was built in full, which is what every existing row is.
ALTER TABLE event_demo_tour ADD COLUMN skipped_at_phase text;

ALTER TABLE event_demo_tour
  ADD CONSTRAINT event_demo_tour_skipped_phase_ck CHECK (
    skipped_at_phase IS NULL OR skipped_at_phase IN (
      'event', 'people', 'forms', 'submissions_a', 'submissions_b',
      'evaluation', 'agenda', 'portal', 'resources', 'comms'
    )
  );
