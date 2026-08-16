import { describe, expect, it, vi } from "vitest";
import { AirtableError, MAX_RECORDS_PER_BATCH, MIN_REQUEST_INTERVAL_MS, createAirtableClient, redactAirtableError } from "./client";

/**
 * The Airtable HTTP client, exercised against an injected `fetchImpl` — no
 * network, no real waiting.
 *
 * Rather than `vi.useFakeTimers()` (which needs careful interleaving with the
 * spacer's internal promise chain to avoid deadlocking on an un-advanced
 * timer), the client's own `now`/`sleep` injection seam is used to run a fully
 * deterministic fake clock: `sleep(ms)` advances the clock by exactly `ms`
 * rather than waiting in real time. This tests the spacing and retry *logic*
 * precisely without a single real millisecond elapsing.
 */

const PAT = "patFAKE0000000000TESTONLY.doNotUseThisAnywhereReal0000000000000000000000000000";

function fakeClock() {
  let clock = 0;
  return {
    now: () => clock,
    sleep: vi.fn(async (ms: number) => { clock += ms; }),
    advance: (ms: number) => { clock += ms; },
  };
}

function fakeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as unknown as Response;
}

describe("request spacing", () => {
  it("spaces twelve concurrent calls at least MIN_REQUEST_INTERVAL_MS apart, in call order", async () => {
    const { now, sleep } = fakeClock();
    const timestamps: number[] = [];
    const fetchImpl = vi.fn(async () => {
      timestamps.push(now());
      return fakeResponse(200, { id: "usrTEST00000001", scopes: [] });
    });
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep });

    await Promise.all(Array.from({ length: 12 }, () => client.whoami()));

    expect(timestamps).toHaveLength(12);
    for (let index = 1; index < timestamps.length; index += 1) {
      const gap = (timestamps[index] ?? 0) - (timestamps[index - 1] ?? 0);
      expect(gap).toBeGreaterThanOrEqual(MIN_REQUEST_INTERVAL_MS);
    }
    expect(client.callCount).toBe(12);
  });

  /**
   * Airtable's 5 req/s is a property of the *base*, and two runs can hold one
   * base at once: the partial unique index that serializes runs is keyed on
   * `event_id`, and nothing stops two events pointing at the same base (an
   * organizer running two conferences out of one). A cron tick syncing A while
   * someone clicks "Sync now" on B used to give that base two independent
   * spacers and twice the rate it is allowed.
   */
  it("spaces two separate clients writing to one base as if they were a single caller", async () => {
    const { now, sleep } = fakeClock();
    const timestamps: number[] = [];
    const fetchImpl = vi.fn(async () => {
      timestamps.push(now());
      return fakeResponse(200, { records: [], createdRecords: [], updatedRecords: [] });
    });
    const one = createAirtableClient(PAT, { fetchImpl, now, sleep });
    const two = createAirtableClient(PAT, { fetchImpl, now, sleep });
    const write = (client: ReturnType<typeof createAirtableClient>) =>
      client.upsertRecords("appSHAREDBASE01", "tblTEST001", [{ fields: { "Openboard ID": "1" } }], ["Openboard ID"]);

    await Promise.all([write(one), write(two), write(one), write(two)]);

    expect(timestamps).toHaveLength(4);
    for (let index = 1; index < timestamps.length; index += 1) {
      expect((timestamps[index] ?? 0) - (timestamps[index - 1] ?? 0)).toBeGreaterThanOrEqual(MIN_REQUEST_INTERVAL_MS);
    }
  });

  it("runs calls issued one at a time back to back with no artificial extra gap beyond the minimum", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = vi.fn(async () => fakeResponse(200, { id: "usrTEST00000001", scopes: [] }));
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep });
    await client.whoami();
    await client.whoami();
    // The second call happened at clock=0 still (nothing advanced it), so the
    // spacer itself must have slept the gap. Asserting the *argument*, not just
    // that it slept: the claim in the title is that there is no extra gap, and
    // `toHaveBeenCalled()` would stay green for a regression that doubled it.
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(MIN_REQUEST_INTERVAL_MS);
  });
});

describe("the ten-record batch assert", () => {
  it("upsertRecords with eleven records throws before any network call", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = vi.fn();
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep });
    const records = Array.from({ length: MAX_RECORDS_PER_BATCH + 1 }, (_, index) => ({ fields: { "Openboard ID": String(index) } }));
    await expect(client.upsertRecords("appTEST00000001", "tblTEST001", records, ["Openboard ID"])).rejects.toThrow(/10 records/u);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("deleteRecords with eleven ids throws before any network call", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = vi.fn();
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep });
    const ids = Array.from({ length: MAX_RECORDS_PER_BATCH + 1 }, (_, index) => `rec${index}`);
    await expect(client.deleteRecords("appTEST00000001", "tblTEST001", ids)).rejects.toThrow(/10 records/u);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("exactly ten records is accepted", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = vi.fn(async () => fakeResponse(200, { records: [], createdRecords: [], updatedRecords: [] }));
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep });
    const records = Array.from({ length: MAX_RECORDS_PER_BATCH }, (_, index) => ({ fields: { "Openboard ID": String(index) } }));
    await expect(client.upsertRecords("appTEST00000001", "tblTEST001", records, ["Openboard ID"])).resolves.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("429 handling", () => {
  it("retries exactly once honouring Retry-After, and succeeds", async () => {
    const { now, sleep } = fakeClock();
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return fakeResponse(429, { error: { type: "RATE_LIMIT_REACHED" } }, { "retry-after": "2" });
      return fakeResponse(200, { id: "usrTEST00000001", scopes: [] });
    });
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep, budgetRemainingMs: () => 30_000 });
    const result = await client.whoami();
    expect(result.userId).toBe("usrTEST00000001");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(client.rateLimitedCount).toBe(1);
  });

  it("a 429 whose wait exceeds the remaining budget throws rate_limited with no sleep", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = vi.fn(async () => fakeResponse(429, { error: { type: "RATE_LIMIT_REACHED" } }, { "retry-after": "30" }));
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep, budgetRemainingMs: () => 500 });
    await expect(client.whoami()).rejects.toMatchObject({ kind: "rate_limited" });
    expect(sleep).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("only ever retries once — a second 429 after the retry throws", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = vi.fn(async () => fakeResponse(429, { error: { type: "RATE_LIMIT_REACHED" } }, { "retry-after": "1" }));
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep, budgetRemainingMs: () => 30_000 });
    await expect(client.whoami()).rejects.toMatchObject({ kind: "rate_limited" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("401/403 — zero retries, ever", () => {
  it("401 throws unauthorized after exactly one call", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = vi.fn(async () => fakeResponse(401, { error: "UNAUTHORIZED" }));
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep, budgetRemainingMs: () => 60_000 });
    await expect(client.whoami()).rejects.toMatchObject({ kind: "unauthorized" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("403 throws forbidden after exactly one call", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = vi.fn(async () => fakeResponse(403, { error: { type: "NOT_AUTHORIZED", message: "missing scope" } }));
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep, budgetRemainingMs: () => 60_000 });
    await expect(client.whoami()).rejects.toMatchObject({ kind: "forbidden" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("422 handling", () => {
  it("a schema-shaped 422 throws kind 'schema' immediately", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = vi.fn(async () => fakeResponse(422, { error: { type: "UNKNOWN_FIELD_NAME", message: "Unknown field name: \"Ghost\"" } }));
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep });
    await expect(client.getBaseSchema("appTEST00000001")).rejects.toMatchObject({ kind: "schema" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  /**
   * The two most likely 422s this integration will ever see are both the
   * organizer's own base: a row they duplicated with Cmd-D so an upsert matches
   * twice, and a value a typed column refuses under `typecast: false`. Read as
   * `request` they became `failed`/`internal` — an operator paged every fifteen
   * minutes, forever, for something only the organizer can fix.
   */
  it("a 422 naming a value the column refuses throws kind 'data_rejected'", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = vi.fn(async () => fakeResponse(422, {
      error: { type: "INVALID_VALUE_FOR_COLUMN", message: "Field \"Email\" cannot accept the provided value" },
    }));
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep });
    await expect(client.upsertRecords("appTEST00000002", "tblTEST001", [{ fields: {} }], ["Openboard ID"]))
      .rejects.toMatchObject({ kind: "data_rejected", status: 422 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a merge key matching two of the customer's records throws kind 'data_rejected'", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = vi.fn(async () => fakeResponse(422, {
      error: { type: "INVALID_REQUEST_UNKNOWN", message: "Cannot update more than one record for fields to merge on" },
    }));
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep });
    await expect(client.upsertRecords("appTEST00000003", "tblTEST001", [{ fields: {} }], ["Openboard ID"]))
      .rejects.toMatchObject({ kind: "data_rejected" });
  });

  it("a non-schema 422 throws kind 'request' immediately", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = vi.fn(async () => fakeResponse(422, { error: { type: "INVALID_REQUEST_BODY", message: "bad body" } }));
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep });
    await expect(client.getBaseSchema("appTEST00000001")).rejects.toMatchObject({ kind: "request" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("whoami's scope list", () => {
  /**
   * Confirmed against the live API: a personal access token's `whoami` answers
   * `{ id, email }` with no `scopes` key whatsoever, even for a token that goes
   * on to create a base and write records. Collapsing that into `[]` reads as
   * "this token can do nothing" and refuses every PAT an organizer could
   * possibly paste, so the absence has to survive as `null`.
   */
  it("reports null when Airtable sends no scopes key, and [] only when it sends an empty one", async () => {
    const { now, sleep } = fakeClock();
    const responses = [
      fakeResponse(200, { id: "usrTEST00000001", email: "priya@example.com" }),
      fakeResponse(200, { id: "usrTEST00000001", scopes: [] }),
      fakeResponse(200, { id: "usrTEST00000001", scopes: ["data.records:read"] }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift() as Response);
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep });

    await expect(client.whoami()).resolves.toEqual({ userId: "usrTEST00000001", email: "priya@example.com", scopes: null });
    await expect(client.whoami()).resolves.toMatchObject({ scopes: [] });
    await expect(client.whoami()).resolves.toMatchObject({ scopes: ["data.records:read"] });
  });
});

describe("5xx and network failures", () => {
  it("retries a 500 once inside budget, then succeeds", async () => {
    const { now, sleep } = fakeClock();
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return fakeResponse(500, { error: { type: "SERVER_ERROR" } });
      return fakeResponse(200, { id: "usrTEST00000001", scopes: [] });
    });
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep, budgetRemainingMs: () => 30_000 });
    await expect(client.whoami()).resolves.toMatchObject({ userId: "usrTEST00000001" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("a thrown network error is retried once inside budget", async () => {
    const { now, sleep } = fakeClock();
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return fakeResponse(200, { id: "usrTEST00000001", scopes: [] });
    });
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep, budgetRemainingMs: () => 30_000 });
    await expect(client.whoami()).resolves.toMatchObject({ userId: "usrTEST00000001" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("the token never leaks", () => {
  it("never appears in a thrown error's message", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = vi.fn(async () => { throw new TypeError(`connect ECONNREFUSED while using ${PAT}`); });
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep, budgetRemainingMs: () => 0 });
    try {
      await client.whoami();
      throw new Error("expected whoami to throw");
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(PAT);
    }
  });

  it("redactAirtableError strips a pat-shaped token from any message and truncates", () => {
    const redacted = redactAirtableError(new Error(`token was ${PAT} — rejected`));
    expect(redacted).not.toContain(PAT);
    expect(redacted).toContain("pat[redacted]");
    expect(redactAirtableError(new Error("x".repeat(1000))).length).toBeLessThanOrEqual(300);
  });

  it("the token is only ever sent in the Authorization header, never as a query param or body field", async () => {
    const { now, sleep } = fakeClock();
    const seenUrls: string[] = [];
    const seenBodies: unknown[] = [];
    const seenAuth: (string | null)[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrls.push(String(input));
      if (init?.body) seenBodies.push(init.body);
      seenAuth.push(new Headers(init?.headers).get("authorization"));
      return fakeResponse(200, { id: "usrTEST00000001", scopes: [] });
    });
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep });
    await client.whoami();
    for (const url of seenUrls) expect(url).not.toContain(PAT);
    for (const body of seenBodies) expect(JSON.stringify(body)).not.toContain(PAT);
    // And the other half of "only ever": a refactor that dropped the header
    // would satisfy every assertion above while sending unauthenticated
    // requests, which is a passing test for a client that cannot work.
    expect(seenAuth).toEqual([`Bearer ${PAT}`]);
  });
});

describe("AirtableError classification helpers", () => {
  it("carries the HTTP status alongside the kind", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = vi.fn(async () => fakeResponse(404, { error: { type: "MODEL_ID_NOT_FOUND", message: "gone" } }));
    const client = createAirtableClient(PAT, { fetchImpl, now, sleep });
    await expect(client.getBaseSchema("appGONE")).rejects.toMatchObject({ kind: "not_found", status: 404 });
  });

  it("AirtableError is an instance of Error and carries its kind through instanceof checks", () => {
    const error = new AirtableError("forbidden", "nope", 403);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AirtableError);
    expect(error.kind).toBe("forbidden");
  });
});
