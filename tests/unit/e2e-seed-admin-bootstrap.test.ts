import { describe, expect, it, vi } from "vitest";
import { seedReset, type SeedDependencies } from "../../e2e/helpers/seed";
import { EVENTS } from "../../e2e/helpers/seeded";

function dependencies(
  statuses: Array<number | null> = [0, 0],
  env: Record<string, string | undefined> = {
    E2E_ADMIN_PASSWORD: "organizer-password",
    E2E_REVIEWER_PASSWORD: "reviewer-password",
  },
) {
  const remaining = [...statuses];
  const run = vi.fn<SeedDependencies["run"]>(() => ({ status: remaining.shift() ?? 0 }));
  return {
    value: {
      databaseUrl: "postgresql://e2e.example/openboard",
      entrypointExists: () => true,
      env,
      run,
    } satisfies SeedDependencies,
    run,
  };
}

describe("E2E seed reset", () => {
  it("recreates seeded Better Auth credentials after the database wipe", () => {
    const { value, run } = dependencies();

    expect(seedReset(true, value)).toEqual({ ran: true });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.slice(0, 2)).toEqual(["pnpm", ["seed", "--wipe"]]);
    expect(run.mock.calls[1]?.slice(0, 2)).toEqual(["pnpm", ["admin:bootstrap"]]);
    expect(run.mock.calls[1]?.[2].env).toMatchObject({
      DATABASE_URL: value.databaseUrl,
      BOOTSTRAP_EVENT_ID: EVENTS.main.id,
      BOOTSTRAP_ADMIN_PASSWORD: "organizer-password",
      BOOTSTRAP_REVIEWER_PASSWORD: "reviewer-password",
    });
  });

  it("accepts the bootstrap password names and uses the same values for reprovisioning", () => {
    const { value, run } = dependencies([0, 0], {
      BOOTSTRAP_ADMIN_PASSWORD: " bootstrap-organizer ",
      BOOTSTRAP_REVIEWER_PASSWORD: " bootstrap-reviewer ",
    });

    expect(seedReset(true, value)).toEqual({ ran: true });
    expect(run.mock.calls[1]?.[2].env).toMatchObject({
      BOOTSTRAP_ADMIN_PASSWORD: "bootstrap-organizer",
      BOOTSTRAP_REVIEWER_PASSWORD: "bootstrap-reviewer",
    });
  });

  it("fails before the destructive seed when either E2E password is missing", () => {
    const { value, run } = dependencies([0, 0], {
      E2E_ADMIN_PASSWORD: "organizer-password",
    });

    expect(() => seedReset(true, value)).toThrow("Missing reviewer E2E password");
    expect(run).not.toHaveBeenCalled();
  });

  it("fails before the destructive seed when a password cannot be bootstrapped", () => {
    const { value, run } = dependencies([0, 0], {
      E2E_ADMIN_PASSWORD: "too-short",
      E2E_REVIEWER_PASSWORD: "reviewer-password",
    });

    expect(() => seedReset(true, value)).toThrow("organizer E2E password must be at least 12 characters");
    expect(run).not.toHaveBeenCalled();
  });

  it("never bootstraps a failed or explicitly skipped seed", () => {
    const failed = dependencies([1]);
    expect(() => seedReset(true, failed.value)).toThrow("pnpm seed exited 1");
    expect(failed.run).toHaveBeenCalledTimes(1);

    const skipped = dependencies([0, 0], { E2E_SEED: "0" });
    expect(seedReset(true, skipped.value)).toEqual({ ran: false, reason: "E2E_SEED=0" });
    expect(skipped.run).not.toHaveBeenCalled();
  });

  it("fails setup when credential bootstrap does not complete", () => {
    const { value, run } = dependencies([0, 1]);

    expect(() => seedReset(true, value)).toThrow("pnpm admin:bootstrap exited 1");
    expect(run).toHaveBeenCalledTimes(2);
  });
});
