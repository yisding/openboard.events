import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { api } from "./api-client";

describe("api client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("unwraps a successful API data envelope before validating the DTO", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "task-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ));

    await expect(api("tasks/task-1", z.object({ id: z.string() }))).resolves.toEqual({ id: "task-1" });
  });
});
