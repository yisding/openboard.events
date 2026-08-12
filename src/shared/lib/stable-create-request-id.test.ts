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

  it("recovers a committed create after its client response is lost without creating another row", async () => {
    const stableId = "10000000-0000-4000-8000-000000000004";
    const requestId = createStableCreateRequestId(() => stableId);
    const committed = new Map<string, { id: string; title: string }>();
    let loseResponse = true;
    const create = vi.fn(async (input: { id: string; title: string }) => {
      const row = committed.get(input.id) ?? input;
      committed.set(input.id, row);
      if (loseResponse) {
        loseResponse = false;
        throw new TypeError("response lost after commit");
      }
      return row;
    });

    const first = requestId.payload(undefined, { title: "Retry-safe create" });
    await expect(create(first as { id: string; title: string })).rejects.toThrow("response lost after commit");
    const retry = requestId.payload(undefined, { title: "Retry-safe create" });
    await expect(create(retry as { id: string; title: string })).resolves.toEqual({ id: stableId, title: "Retry-safe create" });

    expect(first).toEqual(retry);
    expect(committed).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("wires the controller into every audited create payload", () => {
    for (const [path, existingId] of [
      ["../../features/portal/tasks-admin/components/task-editor.tsx", "draft.id"],
      ["../../features/portal/tasks-admin/components/file-requests-view.tsx", "draft.id"],
      ["../../features/portal/resources/components/resource-page-editor.tsx", "draft.id"],
      ["../../features/events/components/event-form.tsx", "undefined"],
      ["../../features/forms/forms-page.tsx", "undefined"],
    ] as const) {
      const sourceText = readFileSync(new URL(path, import.meta.url), "utf8");
      const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const payloadCalls: ts.CallExpression[] = [];
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && node.expression.getText(source).endsWith(".payload")) payloadCalls.push(node);
        ts.forEachChild(node, visit);
      }
      visit(source);
      expect(payloadCalls, path).toHaveLength(1);
      expect(payloadCalls[0]?.arguments[0]?.getText(source), path).toBe(existingId);
    }
  });

  it("resets standalone create ids only at explicit lifecycle boundaries", () => {
    const eventSource = readFileSync(new URL("../../features/events/components/event-form.tsx", import.meta.url), "utf8");
    const formsSource = readFileSync(new URL("../../features/forms/forms-page.tsx", import.meta.url), "utf8");

    expect(eventSource.match(/createRequestId\.current\.reset\(\)/gu)).toHaveLength(1);
    expect(eventSource.indexOf("createRequestId.current.reset()")).toBeGreaterThan(eventSource.indexOf('await api("events"'));

    expect(formsSource.match(/createRequestId\.current\.reset\(\)/gu)).toHaveLength(1);
    expect(formsSource).toContain("function openCreate() {");
    expect(formsSource).toContain("function closeCreate() {");
    expect(formsSource).toContain("openFormCreateLifecycle(createRequestId.current, createOutcomeUnknown.current);");
    expect(formsSource).toContain("closeFormCreateLifecycle(createRequestId.current, createOutcomeUnknown.current);");
    expect(formsSource).toContain("createOutcomeUnknown.current = formCreateOutcomeUnknown(error);");
    expect(formsSource.indexOf("createRequestId.current.reset()", formsSource.indexOf("async function createForm")))
      .toBeGreaterThan(formsSource.indexOf("await requestData<BuilderForm>"));
  });
});
