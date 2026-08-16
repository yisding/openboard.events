import { describe, expect, it } from "vitest";
import { eventIdSchema, airtableConnectionIdSchema } from "@/shared/contracts";
import { openPayload, sealPayload, sealedPayloadAdditionalData } from "@/shared/server/sealed-payload";
import { z } from "zod";
import { airtablePatFingerprint, airtablePatHint, openAirtablePat, sealAirtablePat } from "./secret-payload";

/**
 * The Airtable PAT's seal/open round trip, and the two properties that make it
 * safe to store a third-party credential this way at all: a wrong AAD refuses
 * to open (a ciphertext copied onto another event's row is inert), and the
 * dedicated HKDF context means an envelope sealed for a different purpose can
 * never be opened as this one, even under the same root secret.
 */

const SECRET = "airtable-secret-payload-test-secret-32-bytes-min";
const eventId = eventIdSchema.parse("a17bc000-0000-4000-8000-000000000e01");
const otherEventId = eventIdSchema.parse("a17bc000-0000-4000-8000-000000000e02");
const connectionId = airtableConnectionIdSchema.parse("a17bc000-0000-4000-8000-0000000000c1");
const otherConnectionId = airtableConnectionIdSchema.parse("a17bc000-0000-4000-8000-0000000000c2");

describe("sealAirtablePat / openAirtablePat", () => {
  it("round-trips the token", async () => {
    const sealed = await sealAirtablePat({ pat: "patFAKE0000000000000000" }, { eventId, connectionId }, SECRET);
    const opened = await openAirtablePat(sealed, { eventId, connectionId }, SECRET);
    expect(opened.pat).toBe("patFAKE0000000000000000");
  });

  it("refuses to open under the wrong eventId", async () => {
    const sealed = await sealAirtablePat({ pat: "patFAKE0000000000000000" }, { eventId, connectionId }, SECRET);
    await expect(openAirtablePat(sealed, { eventId: otherEventId, connectionId }, SECRET)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses to open under the wrong connectionId", async () => {
    const sealed = await sealAirtablePat({ pat: "patFAKE0000000000000000" }, { eventId, connectionId }, SECRET);
    await expect(openAirtablePat(sealed, { eventId, connectionId: otherConnectionId }, SECRET)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses to open under the wrong secret — a rotated SESSION_SECRET fails closed rather than opening garbage", async () => {
    const sealed = await sealAirtablePat({ pat: "patFAKE0000000000000000" }, { eventId, connectionId }, SECRET);
    await expect(openAirtablePat(sealed, { eventId, connectionId }, "a-completely-different-secret-32-bytes")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  /*
   * Both negative controls below build their AAD with the same helper
   * `sealAirtablePat` uses, rather than hand-encoding `${eventId}:${connectionId}`.
   * A hand-rolled encoding that drifted from the real one would leave these
   * tests green for the wrong reason — rejected on an AAD mismatch rather than
   * on the HKDF `info` mismatch their names claim to isolate.
   */
  it("cannot open an envelope sealed for a different purpose, even under the same secret", async () => {
    // A stand-in for another payload kind (e.g. "portal_login-v1"): same root
    // secret, different HKDF info string.
    const envelope = await sealPayload({ token: "irrelevant" }, SECRET, {
      schema: z.object({ token: z.string() }),
      info: "some_other_payload-v1",
      additionalData: sealedPayloadAdditionalData(eventId, connectionId),
    });
    await expect(openAirtablePat(envelope, { eventId, connectionId }, SECRET)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("an airtable_pat-v1 envelope cannot be opened by a generic openPayload call under a different info string", async () => {
    const sealed = await sealAirtablePat({ pat: "patFAKE0000000000000000" }, { eventId, connectionId }, SECRET);
    await expect(openPayload(sealed, SECRET, {
      schema: z.object({ pat: z.string() }),
      info: "not_airtable_pat-v1",
      additionalData: sealedPayloadAdditionalData(eventId, connectionId),
      label: "wrong kind",
    })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("airtablePatHint / airtablePatFingerprint", () => {
  it("hint is exactly the last four characters — never enough to reconstruct the token", () => {
    expect(airtablePatHint("patABCDEFGHIJKL.7f2c9d3e1a")).toBe("3e1a");
    expect(airtablePatHint("patABCDEFGHIJKL.0000000f2c")).toBe("0f2c");
    expect(airtablePatHint("patABCDEFGHIJKL.7f2c9d3e1a").length).toBe(4);
  });

  it("fingerprint is a stable sha256 hex digest that changes with the token", async () => {
    const a = await airtablePatFingerprint("patAAAAAAAAAAAAAAAAAAAA");
    const b = await airtablePatFingerprint("patAAAAAAAAAAAAAAAAAAAA");
    const c = await airtablePatFingerprint("patBBBBBBBBBBBBBBBBBBBB");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("fingerprint never contains the token itself", async () => {
    const fingerprint = await airtablePatFingerprint("patSECRETVALUEHERE1234");
    expect(fingerprint).not.toContain("patSECRETVALUEHERE1234");
  });
});
