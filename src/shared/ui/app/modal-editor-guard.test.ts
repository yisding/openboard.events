import { describe, expect, it, vi } from "vitest";
import { createStableCreateRequestId } from "@/shared/lib/stable-create-request-id";
import { editorDraftChanged, requestGuardedEditorClose } from "./modal-editor-guard";

describe("modal editor unsaved-work guard", () => {
  it("compares the current editor draft with its saved baseline", () => {
    const baseline = { title: "Guide", published: true };
    expect(editorDraftChanged(baseline, { ...baseline })).toBe(false);
    expect(editorDraftChanged({ ...baseline, title: "New guide" }, baseline)).toBe(true);
  });

  it("does not dismiss an editor while its save is in flight", () => {
    const runGuarded = vi.fn();
    const close = vi.fn();

    expect(requestGuardedEditorClose({ busy: true, dirty: true, runGuarded, close })).toBe(false);
    expect(runGuarded).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("preserves a create request id when an in-flight dismissal is refused", () => {
    const ids = ["request-one", "request-two"];
    const requestId = createStableCreateRequestId(() => ids.shift() ?? "unexpected");
    requestId.begin();
    const firstPayload = requestId.payload(undefined, { title: "Guide" });
    const close = () => requestId.reset();

    requestGuardedEditorClose({ busy: true, dirty: true, runGuarded: vi.fn(), close });

    expect(requestId.payload(undefined, { title: "Guide" })).toEqual(firstPayload);
    requestGuardedEditorClose({ busy: false, dirty: true, runGuarded: (action) => action(), close });
    requestId.begin();
    expect(requestId.payload(undefined, { title: "Guide" })).toEqual({ id: "request-two", title: "Guide" });
  });

  it("confirms dirty dismissals and closes clean editors directly", () => {
    const runGuarded = vi.fn((action: () => void) => action());
    const close = vi.fn();

    expect(requestGuardedEditorClose({ busy: false, dirty: true, runGuarded, close })).toBe(true);
    expect(runGuarded).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();

    runGuarded.mockClear();
    close.mockClear();
    expect(requestGuardedEditorClose({ busy: false, dirty: false, runGuarded, close })).toBe(true);
    expect(runGuarded).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
