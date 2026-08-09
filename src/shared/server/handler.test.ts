import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "./handler";

const publicGuard = async () => null;

describe("defineHandler", () => {
  it("accepts a bodyless DELETE as an empty object", async () => {
    const route = defineHandler({
      auth: publicGuard,
      input: z.object({}),
      handler: async ({ input }) => input,
    });
    const response = await route(new NextRequest("https://example.test/resource", { method: "DELETE" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: {} });
  });

  it("reports malformed JSON as a validation error", async () => {
    const route = defineHandler({ auth: publicGuard, input: z.object({}), handler: async () => ({}) });
    const response = await route(new NextRequest("https://example.test/resource", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "VALIDATION", message: "Request body must be valid JSON" } });
  });

  it("preserves repeated query parameters as arrays", async () => {
    const route = defineHandler({
      auth: publicGuard,
      input: z.object({ tag: z.array(z.string()) }),
      handler: async ({ input }) => input,
    });
    const response = await route(new NextRequest("https://example.test/resource?tag=agents&tag=safety"));
    expect(await response.json()).toEqual({ data: { tag: ["agents", "safety"] } });
  });

  it("puts normalized Zod errors on error.fieldErrors", async () => {
    const route = defineHandler({ auth: publicGuard, input: z.object({ page: z.coerce.number().int() }), handler: async () => ({}) });
    const response = await route(new NextRequest("https://example.test/resource?page=nope"));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error.fieldErrors.page).toEqual(expect.any(String));
    expect(payload.error.data).toBeUndefined();
  });

  it("retains AppError details as error.data", async () => {
    const route = defineHandler({
      auth: publicGuard,
      input: z.object({}),
      handler: async () => { throw new AppError("CONFLICT", "Already exists", { id: "duplicate" }); },
    });
    const response = await route(new NextRequest("https://example.test/resource"));
    expect(await response.json()).toEqual({ error: { code: "CONFLICT", message: "Already exists", data: { id: "duplicate" } } });
  });
});
