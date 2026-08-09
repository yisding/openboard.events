import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { api } from "./api-client";

describe("api client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("unwraps the successful handler envelope before DTO validation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { name: "Slides" }, meta: { requestId: "req-1" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(api("tasks/1", z.object({ name: z.string() }))).resolves.toEqual({ name: "Slides" });
  });

  it("preserves structured API errors", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: "NOT_FOUND", message: "Task not found" } }, { status: 404 })));
    await expect(api("tasks/missing", z.object({ name: z.string() }))).rejects.toMatchObject({ code: "NOT_FOUND", message: "Task not found" });
  });
});
