import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { api, readFieldErrors } from "./api-client";

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
  // `defineHandler` flattens a zod failure into `error.fieldErrors`. Dropping
  // that map here is what made every rejected form show the summary
  // "Request validation failed" with nothing beside the offending input.
  it("carries the envelope's fieldErrors onto the thrown AppError", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      error: { code: "VALIDATION", message: "Request validation failed", fieldErrors: { endsAt: "Ends At must be after Starts At" } },
    }, { status: 400 })));
    await expect(api("events", z.object({ id: z.string() }), { method: "POST", body: {} })).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { endsAt: "Ends At must be after Starts At" },
    });
  });

  // Handlers that raise their own AppError nest the same map under `data`.
  it("accepts fieldErrors nested under error.data", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      error: { code: "VALIDATION", message: "Some answers need attention", data: { fieldErrors: { title: "Title is required" } } },
    }, { status: 400 })));
    await expect(api("forms/1/submit", z.object({ code: z.number() }), { method: "POST", body: {} })).rejects.toMatchObject({
      fieldErrors: { title: "Title is required" },
    });
  });

  /**
   * The third shape, and the one every hand-thrown domain error in
   * `features/events/server/mutations` uses: `{ field: "<name>" }` in `details`,
   * with the text in the error's own message. Reading only the two `fieldErrors`
   * shapes left exactly the rejections /events/new actually hits — a taken slug,
   * a reserved slug, an unknown timezone — with nothing under the input.
   */
  it("derives a field message from an AppError's { field } details", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      error: { code: "VALIDATION", message: "That slug is taken", data: { field: "slug" } },
    }, { status: 400 })));
    await expect(api("events", z.object({ id: z.string() }), { method: "POST", body: {} })).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { slug: "That slug is taken" },
    });
  });

  it("leaves fieldErrors undefined when the envelope carries none", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: "CONFLICT", message: "That slug is taken" } }, { status: 409 })));
    const failure = await api("events", z.object({ id: z.string() }), { method: "POST", body: {} }).catch((error: unknown) => error);
    expect((failure as { fieldErrors?: unknown }).fieldErrors).toBeUndefined();
  });

  it("maps a non-JSON gateway failure to the standard internal error", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("Bad gateway", { status: 502 })));
    await expect(api("tasks/1", z.object({ name: z.string() }))).rejects.toMatchObject({ code: "INTERNAL", message: "Unexpected API response (502)" });
  });
});

describe("readFieldErrors", () => {
  it("reads each of the three shapes the server states field errors in", () => {
    expect(readFieldErrors({ fieldErrors: { slug: "flat" } })).toEqual({ slug: "flat" });
    expect(readFieldErrors({ data: { fieldErrors: { slug: "nested" } } })).toEqual({ slug: "nested" });
    expect(readFieldErrors({ message: "That slug is taken", data: { field: "slug" } })).toEqual({ slug: "That slug is taken" });
  });

  it("prefers the flat map, then the nested one, then the single-field form", () => {
    expect(readFieldErrors({
      message: "single",
      fieldErrors: { a: "flat" },
      data: { fieldErrors: { b: "nested" }, field: "c" },
    })).toEqual({ a: "flat" });
    expect(readFieldErrors({
      message: "single",
      data: { fieldErrors: { b: "nested" }, field: "c" },
    })).toEqual({ b: "nested" });
  });

  it("returns undefined rather than an empty map when the envelope carries none", () => {
    expect(readFieldErrors(undefined)).toBeUndefined();
    expect(readFieldErrors(null)).toBeUndefined();
    expect(readFieldErrors({ message: "no fields here" })).toBeUndefined();
    expect(readFieldErrors({ message: "m", data: { field: 42 } })).toBeUndefined();
  });
});
