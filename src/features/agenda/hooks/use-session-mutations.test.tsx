/** @vitest-environment happy-dom */

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema, sessionIdSchema } from "@/shared/contracts";
import { agendaKeys } from "./keys";
import { useSessionMutations } from "./use-session-mutations";

const apiMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("a1000000-0000-4000-8000-000000000001");
const sessionId = sessionIdSchema.parse("a2000000-0000-4000-8000-000000000001");
let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

function Harness() {
  const { setPublished } = useSessionMutations(eventId);
  return <button type="button" onClick={() => {
    void setPublished.mutateAsync({ ids: [sessionId], published: true }).catch(() => undefined);
  }}>Publish</button>;
}

beforeEach(() => {
  apiMock.mockReset();
  refreshMock.mockReset();
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  container.remove();
});

describe("bulk schedule publication cache truth", () => {
  it("invalidates and refreshes after an ambiguous failed response", async () => {
    apiMock.mockRejectedValueOnce(new TypeError("connection dropped"));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => root.render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>));

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: agendaKeys.allSessions(eventId) });
    expect(refreshMock).toHaveBeenCalledOnce();
  });
});
