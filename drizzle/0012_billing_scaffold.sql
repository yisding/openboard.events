-- M49 — billing scaffold: plans/entitlements/metering hung off `organizations`.
--
-- Purely additive on top of M43's `organizations` (drizzle/0010_organization_tenancy.sql).
-- No applied migration is edited (DECISIONS.md, "Migration authorship").
--
-- Three tables:
--
--   `billing_plans` — a small, hand-seeded catalog (free/pro/enterprise). `id` is a plain
--   `text` primary key, not a Postgres enum: adding a plan later is an `INSERT`, not an
--   `ALTER TYPE … ADD VALUE` (which cannot run inside the same transaction as other DDL).
--   `max_events IS NULL` means unlimited; `price_cents IS NULL` means custom/"contact us"
--   pricing (today: enterprise), distinct from `0` (free).
--
--   `organization_subscriptions` — exactly one row per organization; the primary key *is*
--   `organization_id`. Every organization gets one the moment it is created
--   (`createOrganizationIn`'s atomic CTE, extended in this same change to insert it alongside
--   the organization and its first owner) or, for organizations that already existed before
--   this migration, via the backfill below. `provider` names which `BillingProviderAdapter`
--   (src/features/billing/server/provider.ts) wrote the row — `'stub'` today, since no live
--   payment provider is wired up.
--
--   `organization_usage_counters` — a generic per-organization, per-metric counter. Scaffolding
--   for future metered billing; the one metric wired up today (`'events'`) backs the one real
--   limit this module enforces, events-per-org (`assertOrganizationCanCreateEventIn`, checked
--   before `provisionOrganizationEventIn` creates a self-serve organization's event). No billing
--   period column yet — today's only writer accumulates and never resets; a future
--   metered-billing migration adds a period column when a real provider needs one.

CREATE TABLE billing_plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  max_events integer CHECK (max_events IS NULL OR max_events > 0),
  price_cents integer CHECK (price_cents IS NULL OR price_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO billing_plans (id, name, max_events, price_cents) VALUES
  ('free', 'Free', 5, 0),
  ('pro', 'Pro', 50, 4900),
  ('enterprise', 'Enterprise', NULL, NULL);

CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'past_due', 'canceled');

CREATE TABLE organization_subscriptions (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES billing_plans(id),
  status subscription_status NOT NULL DEFAULT 'active',
  provider text NOT NULL DEFAULT 'stub',
  provider_customer_id text,
  provider_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Backfill: every organization that exists before this migration gets a subscription row so
-- `getOrganizationEntitlementsIn` never has to guess. The seeded default organization (M43's
-- shared pre-tenancy home for every event created before self-serve organizations existed,
-- 'd3fa0000-0000-4000-8000-000000000001') is deliberately pinned to 'enterprise' (unlimited
-- events) rather than 'free' — it is not a real tenant's billing relationship, and capping it at
-- 5 events would make the billing surface read as "over limit" for a bucket that predates
-- billing and was never sold a plan. Every other pre-existing organization gets 'free', the same
-- plan `createOrganizationIn` now assigns to a brand-new one.
INSERT INTO organization_subscriptions (organization_id, plan_id)
SELECT id, CASE WHEN id = 'd3fa0000-0000-4000-8000-000000000001' THEN 'enterprise' ELSE 'free' END
FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

CREATE TABLE organization_usage_counters (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric text NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, metric)
);
