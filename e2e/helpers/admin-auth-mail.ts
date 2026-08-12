import { BASE_URL, E2E_RESEND_API_KEY } from "./env";
import { queryRows } from "./db";

type OutboxDelivery = {
  provider_message_id: string | null;
  status: string;
  error: string | null;
};

type ResendEmail = {
  id?: string;
  to?: string[];
  subject?: string;
  html?: string | null;
  last_event?: string;
};

export type VerificationDelivery = {
  link: string;
  providerMessageId: string;
  lastEvent: string;
};

const DELIVERED_EVENTS = new Set(["delivered", "opened", "clicked"]);

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'");
}

export function verificationLinkFromHtml(html: string): string | null {
  for (const match of html.matchAll(/href="([^"]+)"/giu)) {
    const candidate = decodeHtmlAttribute(match[1] ?? "");
    try {
      const url = new URL(candidate);
      if (url.pathname.endsWith("/api/auth/verify-email") && url.searchParams.has("token")) return url.toString();
    } catch {
      // Layout links and malformed attributes are not the activation action.
    }
  }
  return null;
}

async function readProviderEmail(providerMessageId: string): Promise<ResendEmail | null> {
  const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(providerMessageId)}`, {
    headers: { authorization: `Bearer ${E2E_RESEND_API_KEY}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Resend email lookup returned ${response.status}`);
  return response.json() as Promise<ResendEmail>;
}

/**
 * Wait for the app's durable row, then prove Resend delivered that exact
 * message and recover the activation URL from the provider's sent copy. This
 * exercises the real send path without exposing a bearer link in preview UI
 * or reaching into the application's encrypted payload.
 */
export async function waitForVerificationDelivery(email: string, timeoutMs = 60_000): Promise<VerificationDelivery> {
  const deadline = Date.now() + timeoutMs;
  let lastState = "no outbox row";
  while (Date.now() < deadline) {
    const [row] = await queryRows<OutboxDelivery>(`
      SELECT provider_message_id, status, error
      FROM admin_auth_email_outbox
      WHERE recipient_email = $1 AND template_key = 'admin_email_verification'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `, [email]);
    if (row) {
      lastState = `${row.status}${row.error ? `: ${row.error}` : ""}`;
      if (["failed", "skipped", "bounced", "complained"].includes(row.status)) {
        throw new Error(`verification delivery became ${lastState}`);
      }
      if (row.provider_message_id) {
        const message = await readProviderEmail(row.provider_message_id);
        const recipients = message?.to?.map((recipient) => recipient.toLowerCase()) ?? [];
        const link = message?.html ? verificationLinkFromHtml(message.html) : null;
        lastState = message ? `Resend ${message.last_event ?? "unknown"}` : "provider message not readable yet";
        if (message && !recipients.includes(email)) {
          throw new Error(`provider message ${row.provider_message_id} was not addressed to ${email}`);
        }
        if (message?.last_event === "bounced") throw new Error(`verification email ${row.provider_message_id} bounced`);
        // opened/clicked are later states of a message that was delivered.
        if (message?.last_event && DELIVERED_EVENTS.has(message.last_event) && link) {
          const expectedOrigin = new URL(BASE_URL).origin;
          if (new URL(link).origin !== expectedOrigin) throw new Error("verification link points outside the preview origin");
          return { link, providerMessageId: row.provider_message_id, lastEvent: message.last_event };
        }
      }
    }
    await delay(1_000);
  }
  throw new Error(`verification email was not delivered within ${timeoutMs}ms (last state: ${lastState})`);
}
