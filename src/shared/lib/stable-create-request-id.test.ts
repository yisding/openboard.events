import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createStableCreateRequestId } from "./stable-create-request-id";

describe("stable create request ids", () => {
  it("reuses one id for an ambiguous retry and generates another for a new create", () => {
    const generate = vi.fn()
      .mockReturnValueOnce("10000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("10000000-0000-4000-8000-000000000002");
    const requestId = createStableCreateRequestId(generate);

    requestId.begin();
    const first = requestId.payload(undefined, { title: "First attempt" });
    const retry = requestId.payload(undefined, { title: "Retry after lost response" });
    expect(first).toMatchObject({ id: "10000000-0000-4000-8000-000000000001" });
    expect(retry).toMatchObject({ id: "10000000-0000-4000-8000-000000000001" });
    expect(generate).toHaveBeenCalledOnce();

    requestId.reset();
    const nextCreate = requestId.payload(undefined, { title: "A genuinely new row" });
    expect(nextCreate).toMatchObject({ id: "10000000-0000-4000-8000-000000000002" });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("does not add a collection idempotency id to an existing edit", () => {
    const generate = vi.fn(() => "10000000-0000-4000-8000-000000000003");
    const requestId = createStableCreateRequestId(generate);
    expect(requestId.payload("existing-id", { title: "Edited" })).toEqual({ title: "Edited" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("wires the controller into every audited create payload", () => {
    for (const path of [
      "../../features/portal/tasks-admin/components/task-editor.tsx",
      "../../features/portal/tasks-admin/components/file-requests-view.tsx",
      "../../features/portal/resources/components/resource-page-editor.tsx",
    ]) {
      const sourceText = readFileSync(new URL(path, import.meta.url), "utf8");
      const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const payloadCalls: ts.CallExpression[] = [];
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && node.expression.getText(source).endsWith(".payload")) payloadCalls.push(node);
        ts.forEachChild(node, visit);
      }
      visit(source);
      expect(payloadCalls, path).toHaveLength(1);
      expect(payloadCalls[0]?.arguments[0]?.getText(source), path).toBe("draft.id");
    }
  });
});
