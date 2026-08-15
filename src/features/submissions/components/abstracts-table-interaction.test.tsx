/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubmissionStatus } from "@/shared/contracts";
import { AbstractsTable } from "./abstracts-table";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const COUNTS: Record<SubmissionStatus | "all", number> = {
  all: 1,
  draft: 0,
  pending: 0,
  accept_queue: 0,
  decline_queue: 0,
  accepted: 0,
  declined: 0,
  withdrawn: 1,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("AbstractsTable workflow interaction", () => {
  it("keeps the mapped workflow view when an exact-status filter is cleared", async () => {
    const onFilter = vi.fn();
    await act(async () => root.render(
      <AbstractsTable
        eventId="00000000-0000-4000-8000-000000000001"
        rows={[]}
        counts={COUNTS}
        view="decided"
        status="withdrawn"
        search=""
        timezone="America/Los_Angeles"
        total={1}
        filteredTotal={1}
        page={1}
        pageSize={25}
        sort="newest"
        onFilter={onFilter}
        onPageChange={() => {}}
        onSortChange={() => {}}
        enableSelection={false}
      />,
    ));

    const clear = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("All decided"));
    if (!clear) throw new Error("Exact-status clear action was not rendered");
    await act(async () => clear.click());

    expect(onFilter).toHaveBeenCalledWith({ view: "decided", status: "all" });
  });

  it("lets an organizer select an exact status from the secondary row", async () => {
    const onFilter = vi.fn();
    await act(async () => root.render(
      <AbstractsTable
        eventId="00000000-0000-4000-8000-000000000001"
        rows={[]}
        counts={COUNTS}
        view="decided"
        status="all"
        search=""
        timezone="America/Los_Angeles"
        total={1}
        filteredTotal={1}
        page={1}
        pageSize={25}
        sort="newest"
        onFilter={onFilter}
        onPageChange={() => {}}
        onSortChange={() => {}}
        enableSelection={false}
      />,
    ));

    const accepted = container.querySelector<HTMLButtonElement>('.abstract-exact-status-filter button:has([data-status="accepted"])');
    if (!accepted) throw new Error("Accepted exact-status control was not rendered");
    await act(async () => accepted.click());

    expect(onFilter).toHaveBeenCalledWith({ status: "accepted" });
  });
});
