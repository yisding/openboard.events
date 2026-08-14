/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/shared/lib/query-client";
import { QueryBoundary } from "./query-boundary";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

function Probe({ queryFn }: { queryFn: () => Promise<string> }) {
  const query = useQuery({ queryKey: ["feature", "event", "list"], queryFn });
  return <span>{query.data ?? "loading"}</span>;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("QueryBoundary", () => {
  it("hydrates a local route cache without refetching fresh data", async () => {
    const queryFn = vi.fn(async () => "network");
    const seeds = [
      { queryKey: ["feature", "event", "list"], data: "server" },
    ];

    await act(async () => root.render(
      <QueryBoundary seeds={seeds}><Probe queryFn={queryFn} /></QueryBoundary>,
    ));

    expect(container.textContent).toBe("server");
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("hydrates and reuses an inherited cache instead of creating a split cache", async () => {
    const queryFn = vi.fn(async () => "network");
    const parent = createQueryClient();
    const seeds = [
      { queryKey: ["feature", "event", "list"], data: "server" },
    ];

    await act(async () => root.render(
      <QueryClientProvider client={parent}>
        <QueryBoundary seeds={seeds}><Probe queryFn={queryFn} /></QueryBoundary>
      </QueryClientProvider>,
    ));

    expect(parent.getQueryData(["feature", "event", "list"])).toBe("server");
    expect(container.textContent).toBe("server");
    expect(queryFn).not.toHaveBeenCalled();
  });
});
