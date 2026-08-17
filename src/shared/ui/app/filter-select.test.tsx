/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilterSelect, filterSelectOptions, highlightSegments, nextActiveValue, type FilterSelectOption } from "./filter-select";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const SPEAKERS: FilterSelectOption[] = [
  { value: "ada", label: "Ada Lovelace", hint: "ada@example.com" },
  { value: "alan", label: "Alan Turing", hint: "alan@example.com" },
  { value: "eva", label: "Éva Tardos", hint: "eva@example.com" },
  { value: "grace", label: "Grace Hopper", hint: "grace@example.com" },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function combobox(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[role="combobox"]');
  if (!input) throw new Error("no combobox rendered");
  return input;
}

function optionLabels(): string[] {
  return [...document.body.querySelectorAll('[role="option"]')].map((option) => option.textContent ?? "");
}

function press(key: string) {
  act(() => { combobox().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
}

function type(text: string) {
  act(() => {
    const input = combobox();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function open() {
  act(() => { combobox().dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
}

describe("filterSelectOptions", () => {
  it("matches every token anywhere in the option, in any order", () => {
    // The whole point of the primitive: a picker of hundreds is searched by
    // whatever the organizer remembers, not by a prefix of the exact label.
    expect(filterSelectOptions(SPEAKERS, "lovelace ada").map((option) => option.value)).toEqual(["ada"]);
    expect(filterSelectOptions(SPEAKERS, "turing alan@").map((option) => option.value)).toEqual(["alan"]);
    expect(filterSelectOptions(SPEAKERS, "hopper turing")).toEqual([]);
  });

  it("searches the hint as well as the label", () => {
    expect(filterSelectOptions(SPEAKERS, "grace@example").map((option) => option.value)).toEqual(["grace"]);
  });

  it("folds diacritics, so a name is findable from a plain keyboard", () => {
    expect(filterSelectOptions(SPEAKERS, "eva tardos").map((option) => option.value)).toEqual(["eva"]);
  });

  it("puts labels that start with the query above ones that merely contain it", () => {
    const options: FilterSelectOption[] = [
      { value: "east", label: "West London" },
      { value: "city", label: "London Bridge" },
    ];

    expect(filterSelectOptions(options, "london").map((option) => option.value)).toEqual(["city", "east"]);
  });

  it("returns every option, in the caller's order, for an empty query", () => {
    expect(filterSelectOptions(SPEAKERS, "  ")).toEqual(SPEAKERS);
  });
});

describe("highlightSegments", () => {
  it("marks the run each token matched", () => {
    expect(highlightSegments("Ada Lovelace", "love")).toEqual([
      { text: "Ada ", match: false },
      { text: "Love", match: true },
      { text: "lace", match: false },
    ]);
  });

  it("marks through a diacritic the query did not spell", () => {
    expect(highlightSegments("Éva Tardos", "eva")).toEqual([
      { text: "Éva", match: true },
      { text: " Tardos", match: false },
    ]);
  });
});

describe("nextActiveValue", () => {
  it("moves within the matches and stops at both ends instead of wrapping", () => {
    expect(nextActiveValue(SPEAKERS, "ada", "ArrowDown")).toBe("alan");
    expect(nextActiveValue(SPEAKERS, "ada", "ArrowUp")).toBe("ada");
    expect(nextActiveValue(SPEAKERS, "grace", "ArrowDown")).toBe("grace");
    expect(nextActiveValue(SPEAKERS, "alan", "Home")).toBe("ada");
    expect(nextActiveValue(SPEAKERS, "alan", "End")).toBe("grace");
  });
});

describe("FilterSelect", () => {
  it("reads as the selected option until it is opened", () => {
    act(() => root.render(<FilterSelect value="grace" onChange={() => {}} options={SPEAKERS} ariaLabel="Speaker" />));

    expect(combobox().value).toBe("Grace Hopper");
    expect(combobox().getAttribute("aria-expanded")).toBe("false");
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
  });

  it("opens already filtered when a letter is typed at the closed control", () => {
    // The one habit the native element taught. Losing it would make the new
    // primitive slower than the one it replaces for anyone who can touch-type.
    act(() => root.render(<FilterSelect value="" onChange={() => {}} options={SPEAKERS} ariaLabel="Speaker" />));

    press("g");

    expect(combobox().getAttribute("aria-expanded")).toBe("true");
    expect(combobox().value).toBe("g");
    expect(optionLabels()).toHaveLength(2); // Grace Hopper, Alan Turing (turing)
  });

  it("filters as the organizer types and commits the active option on Enter", () => {
    const onChange = vi.fn<(value: string) => void>();
    act(() => root.render(<FilterSelect value="" onChange={onChange} options={SPEAKERS} ariaLabel="Speaker" />));

    open();
    expect(optionLabels()).toHaveLength(4);

    type("lovel");
    expect(optionLabels()).toHaveLength(1);

    press("Enter");

    expect(onChange).toHaveBeenCalledWith("ada");
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
  });

  it("selects with the keyboard alone, tracking the active option in aria-activedescendant", () => {
    const onChange = vi.fn<(value: string) => void>();
    act(() => root.render(<FilterSelect value="" onChange={onChange} options={SPEAKERS} ariaLabel="Speaker" />));

    open();
    const first = combobox().getAttribute("aria-activedescendant");
    press("ArrowDown");
    const second = combobox().getAttribute("aria-activedescendant");
    press("Enter");

    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
    expect(onChange).toHaveBeenCalledWith("alan");
  });

  it("leaves the value untouched when Escape closes the list", () => {
    const onChange = vi.fn<(value: string) => void>();
    act(() => root.render(<FilterSelect value="grace" onChange={onChange} options={SPEAKERS} ariaLabel="Speaker" />));

    open();
    type("ada");
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });

    expect(onChange).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(combobox().value).toBe("Grace Hopper");
  });

  it("says how many options survived the filter, for anyone who cannot see the list", () => {
    act(() => root.render(<FilterSelect value="" onChange={() => {}} options={SPEAKERS} ariaLabel="Speaker" />));

    open();
    type("lovel");

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe("1 option");
  });

  it("still posts with a form through a hidden input", () => {
    act(() => root.render(<FilterSelect value="grace" onChange={() => {}} options={SPEAKERS} name="speakerId" ariaLabel="Speaker" />));

    const hidden = container.querySelector<HTMLInputElement>('input[type="hidden"]');
    expect(hidden?.name).toBe("speakerId");
    expect(hidden?.value).toBe("grace");
  });

  it("cannot be opened while it is disabled", () => {
    act(() => root.render(<FilterSelect value="grace" onChange={() => {}} options={SPEAKERS} ariaLabel="Speaker" disabled />));

    open();
    press("ArrowDown");

    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(combobox().disabled).toBe(true);
  });
});
