import { describe, expect, it, vi } from "vitest";
import { focusResourceFieldError } from "./resource-page-editor";

describe("resource page validation recovery", () => {
  it("focuses the first server-invalid field after it renders", () => {
    const focus = vi.fn();
    const querySelector = vi.fn(() => ({ focus }));
    const schedule = vi.fn((callback: () => void) => callback());
    focusResourceFieldError({ querySelector }, schedule);
    expect(schedule).toHaveBeenCalledOnce();
    expect(querySelector).toHaveBeenCalledWith('[aria-invalid="true"]');
    expect(focus).toHaveBeenCalledOnce();
  });
});
