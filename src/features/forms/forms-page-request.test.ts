import { afterEach, describe, expect, it, vi } from "vitest";
import { createStableCreateRequestId } from "@/shared/lib/stable-create-request-id";
import {
  FormCreateRequestError,
  closeFormCreateLifecycle,
  formCreateOutcomeUnknown,
  openFormCreateLifecycle,
  requestData,
} from "./forms-page";

afterEach(() => vi.unstubAllGlobals());

describe("form create request outcomes", () => {
  it("marks a transport failure as ambiguous", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("response lost")));

    await expect(requestData("/forms", { method: "POST" })).rejects.toMatchObject({
      name: "FormCreateRequestError",
      outcomeUnknown: true,
    });
  });

  it("marks an unreadable successful response as ambiguous", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("not json", { status: 200 })));

    await expect(requestData("/forms", { method: "POST" })).rejects.toMatchObject({
      outcomeUnknown: true,
    });
  });

  it("marks a server error as ambiguous", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      error: { message: "The database connection dropped" },
    }, { status: 503 })));

    await expect(requestData("/forms", { method: "POST" })).rejects.toEqual(
      new FormCreateRequestError("The database connection dropped", true),
    );
  });

  it("marks a client rejection as definite", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      error: { message: "Name is already in use" },
    }, { status: 409 })));

    await expect(requestData("/forms", { method: "POST" })).rejects.toEqual(
      new FormCreateRequestError("Name is already in use", false),
    );
  });

  it("preserves the stable id across dismiss, reopen, and retry after a 5xx", async () => {
    const generate = vi.fn(() => "10000000-0000-4000-8000-000000000501");
    const requestId = createStableCreateRequestId(generate);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: { message: "Write outcome unknown" } }, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ data: { id: "10000000-0000-4000-8000-000000000501" } }));
    vi.stubGlobal("fetch", fetcher);

    openFormCreateLifecycle(requestId, false);
    const first = requestId.payload(undefined, { internalName: "Main CFP" });
    const failure = await requestData("/forms", { method: "POST", body: JSON.stringify(first) }).catch((error: unknown) => error);
    const outcomeUnknown = formCreateOutcomeUnknown(failure);
    closeFormCreateLifecycle(requestId, outcomeUnknown);
    openFormCreateLifecycle(requestId, outcomeUnknown);
    const retry = requestId.payload(undefined, { internalName: "Main CFP" });

    await expect(requestData("/forms", { method: "POST", body: JSON.stringify(retry) })).resolves.toEqual({
      id: "10000000-0000-4000-8000-000000000501",
    });
    expect(outcomeUnknown).toBe(true);
    expect(first).toEqual(retry);
    expect(generate).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as unknown)).toEqual([first, retry]);
  });

  it("resets the id across dismiss and reopen after a definite 4xx", async () => {
    const generate = vi.fn()
      .mockReturnValueOnce("10000000-0000-4000-8000-000000000401")
      .mockReturnValueOnce("10000000-0000-4000-8000-000000000402");
    const requestId = createStableCreateRequestId(generate);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      error: { message: "Name is already in use" },
    }, { status: 409 })));

    openFormCreateLifecycle(requestId, false);
    const rejected = requestId.payload(undefined, { internalName: "Main CFP" });
    const failure = await requestData("/forms", { method: "POST", body: JSON.stringify(rejected) }).catch((error: unknown) => error);
    const outcomeUnknown = formCreateOutcomeUnknown(failure);
    closeFormCreateLifecycle(requestId, outcomeUnknown);
    openFormCreateLifecycle(requestId, outcomeUnknown);
    const nextLifecycle = requestId.payload(undefined, { internalName: "Main CFP" });

    expect(outcomeUnknown).toBe(false);
    expect(nextLifecycle).not.toEqual(rejected);
    expect(nextLifecycle).toMatchObject({ id: "10000000-0000-4000-8000-000000000402" });
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
