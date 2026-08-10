import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseResendWebhookEvent, verifyResendWebhookSignature } from "./server/webhook";

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const BODY = '{"test": 2432232314}';

/**
 * An independently computed reference (Node's `crypto`, not the Web Crypto
 * path `verifyResendWebhookSignature` itself uses) at a fresh timestamp — a
 * fixed historical timestamp would eventually fall outside the 5-minute
 * replay tolerance every time this suite runs later, so the timestamp is
 * `now` at test time and the signature is derived from it, not hardcoded.
 */
function signAt(timestamp: string, body = BODY): string {
  const secretBytes = Buffer.from(SECRET.replace("whsec_", ""), "base64");
  const digest = createHmac("sha256", secretBytes).update(`${ID}.${timestamp}.${body}`).digest("base64");
  return `v1,${digest}`;
}

describe("Resend webhook signature verification", () => {
  it("verifies a correctly signed, fresh request", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    await expect(verifyResendWebhookSignature({ id: ID, timestamp, signature: signAt(timestamp), body: BODY, secret: SECRET })).resolves.toBe(true);
  });

  it("rejects a tampered body, id, or a signature for the wrong secret", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signAt(timestamp);
    await expect(verifyResendWebhookSignature({ id: ID, timestamp, signature, body: '{"test": 9999999}', secret: SECRET })).resolves.toBe(false);
    await expect(verifyResendWebhookSignature({ id: "msg_wrong", timestamp, signature, body: BODY, secret: SECRET })).resolves.toBe(false);
    await expect(verifyResendWebhookSignature({ id: ID, timestamp, signature, body: BODY, secret: `whsec_${"a".repeat(32)}` })).resolves.toBe(false);
  });

  it("accepts any matching entry in a multi-signature header (key rotation)", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0,not-a-real-signature ${signAt(timestamp)} v2,also-not-real`;
    await expect(verifyResendWebhookSignature({ id: ID, timestamp, signature, body: BODY, secret: SECRET })).resolves.toBe(true);
  });

  it("rejects a correctly signed request outside the replay tolerance", async () => {
    const stale = String(Math.floor(Date.now() / 1000) - 10 * 60);
    await expect(verifyResendWebhookSignature({ id: ID, timestamp: stale, signature: signAt(stale), body: BODY, secret: SECRET })).resolves.toBe(false);
  });

  it("rejects a non-numeric timestamp instead of throwing", async () => {
    await expect(verifyResendWebhookSignature({ id: ID, timestamp: "not-a-number", signature: signAt("not-a-number"), body: BODY, secret: SECRET })).resolves.toBe(false);
  });
});

describe("Resend webhook event parsing", () => {
  it("maps email.bounced/email.complained to a suppression reason", () => {
    expect(parseResendWebhookEvent(JSON.stringify({ type: "email.bounced", data: { email_id: "id-1" } }))).toEqual({ emailId: "id-1", reason: "bounce" });
    expect(parseResendWebhookEvent(JSON.stringify({ type: "email.complained", data: { email_id: "id-2" } }))).toEqual({ emailId: "id-2", reason: "complaint" });
  });

  it("ignores every other recognized event type without error", () => {
    expect(parseResendWebhookEvent(JSON.stringify({ type: "email.delivered", data: { email_id: "id-3" } }))).toBeNull();
    expect(parseResendWebhookEvent(JSON.stringify({ type: "email.opened", data: { email_id: "id-4" } }))).toBeNull();
  });

  it("returns null for malformed JSON or a payload missing the fields it needs", () => {
    expect(parseResendWebhookEvent("not json")).toBeNull();
    expect(parseResendWebhookEvent(JSON.stringify({ type: "email.bounced" }))).toBeNull();
    expect(parseResendWebhookEvent(JSON.stringify({ data: { email_id: "id-5" } }))).toBeNull();
  });
});
