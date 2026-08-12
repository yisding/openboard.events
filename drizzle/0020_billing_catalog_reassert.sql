-- Re-assert the billing catalog and the one-subscription-per-organization
-- invariant that 0012_billing_scaffold.sql established.
--
-- Why this exists: `pnpm seed --wipe` TRUNCATEs every base table in `public` —
-- including `billing_plans` and `organization_subscriptions`, whose rows are
-- authored by migration 0012, not by the seed modules. A wiped-and-reseeded
-- database therefore kept the billing schema but lost the plan catalog, and
-- every self-serve signup died on `organization_subscriptions_plan_id_fkey`
-- inside `createOrganizationIn`'s CTE — surfacing to the user as Better Auth's
-- generic `unable_to_create_user`. That is exactly what happened to the
-- deployed preview database. The seed orchestrator now restores these rows
-- itself (scripts/seed/events.ts), and this migration repairs any database
-- wiped before that fix, restoring 0012's two data guarantees:
--
--   1. The plan catalog rows exist (`createOrganizationIn` inserts 'free').
--   2. Every organization has a subscription row (`getOrganizationEntitlementsIn`
--      treats "no row" as an impossibility, per 0012).
--
-- Both statements are ON CONFLICT DO NOTHING: on a database that was never
-- wiped this whole file is a no-op, and it stays safe to re-run anywhere.

INSERT INTO billing_plans (id, name, max_events, price_cents) VALUES
  ('free', 'Free', 5, 0),
  ('pro', 'Pro', 50, 4900),
  ('enterprise', 'Enterprise', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- Same plan assignment as 0012's backfill: the seeded default organization is
-- pinned to 'enterprise' (it predates billing and must not read as "over
-- limit"); every other organization missing a row gets 'free', matching what
-- `createOrganizationIn` gives a brand-new organization.
INSERT INTO organization_subscriptions (organization_id, plan_id)
SELECT id, CASE WHEN id = 'd3fa0000-0000-4000-8000-000000000001' THEN 'enterprise' ELSE 'free' END
FROM organizations
ON CONFLICT (organization_id) DO NOTHING;
