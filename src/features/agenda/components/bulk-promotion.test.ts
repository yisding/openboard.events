import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sessionIdSchema, submissionIdSchema, type BulkAgendaPromotionResult } from "@/shared/contracts";
import { bulkPromotionSummary, rejectedPromotionIds } from "./unscheduled-tray";

const submission = (suffix: string) => submissionIdSchema.parse(`00000000-0000-4000-8000-${suffix}`);
const session = (suffix: string) => sessionIdSchema.parse(`00000000-0000-4000-8000-${suffix}`);

const result: BulkAgendaPromotionResult = {
  results: [
    {
      submissionId: submission("000000000001"),
      sessionId: session("000000000011"),
      outcome: "created",
    },
    {
      submissionId: submission("000000000002"),
      sessionId: session("000000000012"),
      outcome: "already_existed",
    },
    {
      submissionId: submission("000000000003"),
      outcome: "rejected",
      code: "VALIDATION",
      message: "Only accepted abstracts can be added to the agenda",
    },
  ],
  created: 1,
  alreadyExisted: 1,
  rejected: 1,
};

describe("agenda bulk promotion UI", () => {
  it("summarizes all server outcomes and retains only rejected rows", () => {
    expect(bulkPromotionSummary(result)).toBe("1 created · 1 already on the agenda · 1 rejected");
    expect(rejectedPromotionIds(result)).toEqual(["00000000-0000-4000-8000-000000000003"]);
  });

  it("provides accessible selection and preserves unconfirmed work", () => {
    const source = readFileSync(new URL("./unscheduled-tray.tsx", import.meta.url), "utf8");
    const catchStart = source.indexOf("} catch (caught) {");
    const failedRequest = source.slice(catchStart, source.indexOf("\n  return (", catchStart));

    expect(source).toContain('type="checkbox"');
    expect(source).toContain('aria-label={`Select abstract ${row.code}: ${row.title}`}');
    expect(source).toContain('aria-pressed={allSelected}');
    expect(source).toContain(': "Select all"');
    expect(source).toContain('`Add ${selectedRows.length}`');
    expect(source).toContain('className="accepted-tray-feedback" role="alert"');
    expect(failedRequest).toContain('kind: "unconfirmed"');
    expect(failedRequest).not.toContain("setSelected(");
  });

  it("uses one settled refresh and a bounded, deduplicated server route", () => {
    const hook = readFileSync(new URL("../hooks/use-session-mutations.ts", import.meta.url), "utf8");
    const route = readFileSync(new URL("../../../app/api/internal/agenda/promote/bulk/route.ts", import.meta.url), "utf8");

    expect(hook).toContain("const promoteBatch = useMutation({");
    expect(hook).toContain("onSettled: refreshPromotion");
    expect(hook).not.toContain("router.refresh()");
    expect(route).toContain(".min(1).max(MAX_BULK_AGENDA_PROMOTIONS)");
    expect(route).toContain("new Set(value.submissionIds).size !== value.submissionIds.length");
    expect(route).toContain("auth: agendaAuth()");
  });
});
