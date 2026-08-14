import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "./query-client";

describe("query client consistency", () => {
  it("uses the shared freshness and mutation retry policy", () => {
    const client = createQueryClient();
    expect(client.getDefaultOptions().queries).toMatchObject({
      staleTime: 15_000,
      refetchOnWindowFocus: true,
    });
    expect(client.getDefaultOptions().mutations).toMatchObject({ retry: false });
  });

  it("seeds authoritative server data under the caller's exact key", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_786_700_000_000);
    const client = createQueryClient([
      { queryKey: ["comms", "event-1", "templates"], data: [{ id: "template-1" }] },
    ]);

    expect(client.getQueryState(["comms", "event-1", "templates"])).toMatchObject({
      data: [{ id: "template-1" }],
      dataUpdatedAt: 1_786_700_000_000,
      status: "success",
    });
  });
});
