-- First Fair — the demo event and its guided tour.
--
-- A demo event is a fully functional event that must never send mail, never
-- consume a plan slot, and never be mistaken for a customer's real programme.
-- Follows drizzle/0010's ADD COLUMN … NOT NULL DEFAULT playbook: the ALTER
-- backfills every existing row and every existing writer keeps working.
ALTER TABLE events ADD COLUMN is_demo boolean NOT NULL DEFAULT false;

-- The entitlement gate and the billing summary count real events only, so the
-- predicate that filters them belongs in the index rather than in a scan.
CREATE INDEX events_org_real_idx ON events (organization_id) WHERE is_demo = false;

-- Provisioning cursor AND tour cursor in one row: same primary key, same
-- lifecycle, same composite foreign key, same two readers. Cloned from
-- drizzle/0021's `event_onboarding_progress` shape — including the composite
-- (event_id, organization_id) key that keeps a cursor from ever naming an
-- event in a different tenant — but deliberately a different table: the setup
-- wizard's checkpoint drives redirects, and a tutorial must never be able to
-- trap an organizer in setup.
CREATE TABLE event_demo_tour (
  event_id        uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- The organizer who asked for the demo: the tour is assigned work (round-one
  -- review assignments) for this person, and the cursor resumes for them.
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Bumping the dataset version mints a new id namespace, which is the only
  -- supported way to change the provisioned dataset's shape.
  dataset_version integer NOT NULL DEFAULT 1,
  -- Provisioning runs one bounded phase per HTTP request and advances this
  -- cursor with a compare-and-set, so a double-clicked button cannot advance
  -- twice and a lost response simply re-runs an idempotent phase.
  provision_phase text NOT NULL DEFAULT 'event',
  tour_state      text NOT NULL DEFAULT 'not_started',
  chapter         text NOT NULL DEFAULT 'cold-open',
  step_id         text NOT NULL DEFAULT 'coldopen.hello',
  -- The armed objective and the world snapshot taken when it armed. Persisted
  -- rather than held in memory so a reload mid-step cannot re-baseline: an
  -- action already taken would otherwise become invisible and have to be redone.
  armed_step_id   text,
  armed_baseline  jsonb,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_demo_tour_phase_ck CHECK (provision_phase IN (
    'event', 'people', 'forms', 'submissions_a', 'submissions_b', 'evaluation',
    'agenda', 'portal', 'resources', 'comms', 'ready', 'failed'
  )),
  CONSTRAINT event_demo_tour_state_ck CHECK (tour_state IN (
    'not_started', 'active', 'paused', 'complete'
  )),
  CONSTRAINT event_demo_tour_event_org_fk
    FOREIGN KEY (event_id, organization_id)
    REFERENCES events(id, organization_id)
    ON DELETE CASCADE
);

CREATE INDEX event_demo_tour_org_idx
  ON event_demo_tour (organization_id, updated_at DESC);

-- The achievement log: append-only, one row per objective the player finished
-- or deliberately skipped. ON CONFLICT DO NOTHING makes completion idempotent
-- without a compare-and-set, and gives the curtain call something to count.
CREATE TABLE event_tour_steps (
  event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  step_id      text NOT NULL,
  outcome      text NOT NULL DEFAULT 'completed',
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, step_id),
  CONSTRAINT event_tour_steps_outcome_ck CHECK (outcome IN ('completed', 'skipped'))
);

-- `organization_onboarding_milestones.milestone` is not free text: drizzle/0023
-- constrains it to a fixed vocabulary, and
-- `tryRecordOrganizationOnboardingMilestoneIn` deliberately swallows write
-- failures so a product signal can never turn a completed customer action into
-- a 500. Adding the three demo/tour milestones without widening this CHECK
-- would therefore make the funnel go quietly dark rather than fail loudly.
-- Widening a CHECK cannot invalidate an existing row, so this is additive in
-- effect; the constraint keeps its name, so its allowlist entry stays valid.
ALTER TABLE organization_onboarding_milestones
  DROP CONSTRAINT organization_onboarding_milestones_name_ck;
ALTER TABLE organization_onboarding_milestones
  ADD CONSTRAINT organization_onboarding_milestones_name_ck CHECK (milestone IN (
    'signup_completed',
    'email_verified',
    'event_created',
    'form_published',
    'public_form_visited',
    'demo_provisioned',
    'tour_completed',
    'real_event_after_demo'
  ));
