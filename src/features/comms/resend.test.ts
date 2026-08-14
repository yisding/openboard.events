import { describe, expect, it, vi } from "vitest";
import { sendViaResend } from "@/shared/server/email-provider";

const message = {
  apiKey: "re_secret",
  from: "mail@example.com",
  to: "speaker@example.com",
  subject: "A subject",
  html: "<p>Hello</p>",
  text: "Hello",
  idempotencyKey: "event:received:submission",
};

describe("email provider adapter", () => {
  it("sends both MIME alternatives with an idempotency header", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: "provider-123" }), { status: 200 }));
    await expect(sendViaResend(message, fetcher as typeof fetch)).resolves.toBe("provider-123");
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer re_secret",
      "Idempotency-Key": "event:received:submission",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({ to: ["speaker@example.com"], html: "<p>Hello</p>", text: "Hello" });
  });

  it("surfaces a bounded provider error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("provider unavailable", { status: 503 }));
    await expect(sendViaResend(message, fetcher as typeof fetch)).rejects.toThrowError("email provider 503: provider unavailable");
  });

  it("passes calendar attachment content types through to Resend", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: "provider-ics" }), { status: 200 }));
    await sendViaResend({
      ...message,
      attachments: [{
        filename: "invite.ics",
        content: "QkVHSU46VkNBTEVOREFS",
        content_type: "text/calendar; charset=utf-8; method=REQUEST",
      }],
    }, fetcher as typeof fetch);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.attachments).toEqual([{
      filename: "invite.ics",
      content: "QkVHSU46VkNBTEVOREFS",
      content_type: "text/calendar; charset=utf-8; method=REQUEST",
    }]);
  });
});
