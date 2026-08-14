/** @vitest-environment happy-dom */

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema, sessionIdSchema, submissionIdSchema } from "@/shared/contracts";
import { agendaKeys } from "./keys";
import { useSessionMutations } from "./use-session-mutations";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("a1000000-0000-4000-8000-000000000001");
const sessionId = sessionIdSchema.parse("a2000000-0000-4000-8000-000000000001");
const submissionId = submissionIdSchema.parse("a3000000-0000-4000-8000-000000000001");
let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

function Harness({ action }: { action: "publish" | "promote" }) {
  const { setPublished, promote } = useSessionMutations(eventId);
  return <button type="button" onClick={() => {
    const request = action === "publish"
      ? setPublished.mutateAsync({ ids: [sessionId], published: true })
      : promote.mutateAsync(submissionId);
    void request.catch(() => undefined);
  }}>Run</button>;
}

beforeEach(() => {
  apiMock.mockReset();
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

describe("agenda mutation cache truth", () => {
  it("refreshes sessions and the announcement bundle after an ambiguous publication response", async () => {
    apiMock.mockRejectedValueOnce(new TypeError("connection dropped"));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => root.render(<QueryClientProvider client={queryClient}><Harness action="publish" /></QueryClientProvider>));

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: agendaKeys.allSessions(eventId) });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: agendaKeys.announceBundle(eventId) });
    });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: agendaKeys.accepted(eventId) });
  });

  it("refreshes both agenda panels after a successful promotion", async () => {
    apiMock.mockResolvedValueOnce({ sessionId });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => root.render(<QueryClientProvider client={queryClient}><Harness action="promote" /></QueryClientProvider>));

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: agendaKeys.allSessions(eventId) });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: agendaKeys.accepted(eventId) });
    });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: agendaKeys.announceBundle(eventId) });
  });
});
