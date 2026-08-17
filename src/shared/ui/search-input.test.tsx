/** @vitest-environment happy-dom */

import * as React from "react";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchInput } from "./ui-kit";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()?.();
});

async function render(element: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return container;
}

function Filter({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <SearchInput label="Search forms" placeholder="Search forms" value={value} onChange={setValue} />;
}

const clearButton = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]');
const input = (container: HTMLElement) => container.querySelector<HTMLInputElement>('input[aria-label="Search forms"]');

describe("SearchInput", () => {
  it("offers a clear control only once there is something to clear, and clearing empties the field", async () => {
    const container = await render(<Filter />);
    const field = input(container);
    if (!field) throw new Error("the search field did not render");

    expect(clearButton(container)).toBeNull();

    await act(async () => {
      field.value = "keynote";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const clear = clearButton(container);
    if (!clear) throw new Error("a non-empty search field must offer a clear control");

    await act(async () => clear.click());
    expect(input(container)?.value).toBe("");
    expect(clearButton(container)).toBeNull();
  });

  it("clears through onClear when the caller owns more than the input's value", async () => {
    const onClear = vi.fn();
    const container = await render(
      <SearchInput label="Search speakers" value="ada" onChange={() => undefined} onClear={onClear} />,
    );
    await act(async () => clearButton(container)?.click());
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("is a real form when the search only runs on Enter, and a label otherwise", async () => {
    const onSubmit = vi.fn();
    const submitting = await render(
      <SearchInput label="Search the directory" value="ada" onChange={() => undefined} onSubmit={onSubmit} />,
    );
    const form = submitting.querySelector("form.table-search");
    if (!form) throw new Error("a submit-driven search must be a form so the platform handles Enter");
    await act(async () => form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    const filtering = await render(<Filter initial="ada" />);
    expect(filtering.querySelector("label.table-search")).not.toBeNull();
    expect(filtering.querySelector("form")).toBeNull();
  });
});
