import { describe, expect, it } from "vitest";
import { isAppError } from "@/shared/lib/errors";
import { requireCrmMergeId, requireCrmSegmentId, requireOrganizationContactId, requirePipelineId } from "./_lib";

const UUID = "c0000000-0000-4000-8000-000000000001";

/**
 * Every id these routes read out of the path is validated before it reaches a
 * `uuid` column. The segment resolve route used to take its param raw, so a
 * stale bookmark produced a Postgres `22P02 invalid input syntax for type uuid`
 * — which `errorEnvelope` maps to INTERNAL. The organizer got a 500 instead of
 * the NOT_FOUND the handler intends, and `captureError` filed the throw in
 * `operational_error_buckets`, inflating the recent-error count the alerting
 * runbook pages on.
 */
describe("crm route param readers", () => {
  const readers = [
    ["segmentId", requireCrmSegmentId] as const,
    ["mergeId", requireCrmMergeId] as const,
    ["pipelineId", requirePipelineId] as const,
    ["organizationContactId", requireOrganizationContactId] as const,
  ];

  for (const [key, read] of readers) {
    it(`accepts a uuid for ${key} and rejects anything else before the query runs`, () => {
      expect(read({ [key]: UUID })).toBe(UUID);

      const missing = (() => { try { read({}); return null; } catch (thrown) { return thrown; } })();
      expect(isAppError(missing) && missing.code).toBe("VALIDATION");

      // A non-uuid must not reach Postgres.
      expect(() => read({ [key]: "not-a-uuid" })).toThrow();
    });
  }
});
