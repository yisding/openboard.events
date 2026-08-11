import { describe, expect, it, vi } from "vitest";
import { focusResourceFieldError, recoverStaleResourcePage } from "./resource-page-editor";

describe("resource page validation recovery", () => {
  it("focuses the first server-invalid field after it renders", () => {
    const focus = vi.fn();
    const querySelector = vi.fn(() => ({ focus }));
    let deferred: (() => void) | undefined;
    const schedule = vi.fn((callback: () => void) => { deferred = callback; });
    focusResourceFieldError({ querySelector }, schedule);
    expect(schedule).toHaveBeenCalledOnce();
    expect(querySelector).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    deferred?.();
    expect(querySelector).toHaveBeenCalledWith('[aria-invalid="true"]');
    expect(focus).toHaveBeenCalledOnce();
  });

  it("awaits stale recovery and reports an actionable refresh failure", async () => {
    let rejectReload: ((reason: Error) => void) | undefined;
    const reload = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectReload = reject; }));
    const onFailure = vi.fn();
    const recovery = recoverStaleResourcePage(reload, onFailure);
    expect(onFailure).not.toHaveBeenCalled();
    rejectReload?.(new Error("offline"));
    await expect(recovery).resolves.toBe(false);
    expect(onFailure).toHaveBeenCalledOnce();
  });
});
