import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("agenda organizer feedback", () => {
  it("announces failed agenda mutations as errors", () => {
    const dialog = readFileSync(new URL("./session-form-dialog.tsx", import.meta.url), "utf8");
    const tray = readFileSync(new URL("./unscheduled-tray.tsx", import.meta.url), "utf8");
    const move = readFileSync(new URL("../hooks/use-move-session.ts", import.meta.url), "utf8");

    expect(dialog.match(/toast\(message, \{ kind: "error" \}\)/g)).toHaveLength(2);
    expect(dialog).toContain('toast(messageFor(caught, "Could not restore that revision"), { kind: "error" })');
    expect(tray).toContain('selected rows are safe to retry.`, { kind: "error" })');
    expect(move).toContain('"Could not move that session", { kind: "error" })');
  });

  it("keeps history load failure distinct from empty history and offers retry", () => {
    const source = readFileSync(new URL("./session-form-dialog.tsx", import.meta.url), "utf8");

    expect(source).toContain('query.isError && (');
    // The failed-to-load state is `LoadFailure`, which owns the alert role, the
    // retry control and its "Retrying…" wording. What this file still has to
    // get right is which of the three states it is in, and that the retry it
    // hands over actually refetches.
    expect(source).toContain('<LoadFailure message="Could not load content history." retrying={query.isFetching} onRetry={() => { void query.refetch(); }} />');
    expect(source).toContain('!query.isLoading && !query.isError && revisions.length === 0');
  });
});
