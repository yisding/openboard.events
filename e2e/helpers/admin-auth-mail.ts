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

export type PortalLoginDelivery = {
  otp: string;
  providerMessageId: string;
  lastEvent: string;
};

const DELIVERED_EVENTS = new Set(["delivered", "opened", "clicked"]);

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function decodeHtmlAttribute(value: string): string {
  // `&amp;` last: decoding it first would let an escaped `&amp;quot;` collapse
  // into a bare `"` and cut the recovered link short.
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");
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

/** Read the code from the default portal-login sentence, not from unrelated
 * six-digit values that may occur in the shared email shell. */
export function portalOtpFromHtml(html: string): string | null {
  return /sign-in code is(?:\s|&nbsp;|<[^>]*>)*(\d{6})(?!\d)/iu.exec(html)?.[1] ?? null;
}

async function readProviderEmail(providerMessageId: string): Promise<ResendEmail | null> {
  const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(providerMessageId)}`, {
    headers: { authorization: `Bearer ${E2E_RESEND_API_KEY}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Resend email lookup returned ${response.status}`);
  return response.json() as Promise<ResendEmail>;
}

async function waitForDeliveredMessage(
  email: string,
  loadOutbox: () => Promise<OutboxDelivery | undefined>,
  description: string,
  timeoutMs: number,
): Promise<{ message: ResendEmail; providerMessageId: string; lastEvent: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastState = "no outbox row";
  while (Date.now() < deadline) {
    const row = await loadOutbox();
    if (row) {
      lastState = `${row.status}${row.error ? `: ${row.error}` : ""}`;
      if (["failed", "skipped", "bounced", "complained"].includes(row.status)) {
        throw new Error(`${description} delivery became ${lastState}`);
      }
      if (row.provider_message_id) {
        const message = await readProviderEmail(row.provider_message_id);
        const recipients = message?.to?.map((recipient) => recipient.toLowerCase()) ?? [];
        lastState = message ? `Resend ${message.last_event ?? "unknown"}` : "provider message not readable yet";
        if (message && !recipients.includes(email.toLowerCase())) {
          throw new Error(`provider message ${row.provider_message_id} was not addressed to ${email}`);
        }
        if (message?.last_event === "bounced") throw new Error(`${description} email ${row.provider_message_id} bounced`);
        if (message?.last_event && DELIVERED_EVENTS.has(message.last_event)) {
          return { message, providerMessageId: row.provider_message_id, lastEvent: message.last_event };
        }
      }
    }
    await delay(1_000);
  }
  throw new Error(`${description} email was not delivered within ${timeoutMs}ms (last state: ${lastState})`);
}

/**
 * Wait for the app's durable row, then prove Resend delivered that exact
 * message and recover the activation URL from the provider's sent copy. This
 * exercises the real send path without exposing a bearer link in preview UI
 * or reaching into the application's encrypted payload.
 */
export async function waitForVerificationDelivery(email: string, timeoutMs = 60_000): Promise<VerificationDelivery> {
  const delivered = await waitForDeliveredMessage(email, async () => {
    const [row] = await queryRows<OutboxDelivery>(`
      SELECT provider_message_id, status, error
      FROM admin_auth_email_outbox
      WHERE recipient_email = $1 AND template_key = 'admin_email_verification'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `, [email]);
    return row;
  }, "verification", timeoutMs);
  const link = delivered.message.html ? verificationLinkFromHtml(delivered.message.html) : null;
  if (!link) throw new Error(`verification email ${delivered.providerMessageId} has no activation link`);
  const expectedOrigin = new URL(BASE_URL).origin;
  if (new URL(link).origin !== expectedOrigin) throw new Error("verification link points outside the preview origin");
  return { link, providerMessageId: delivered.providerMessageId, lastEvent: delivered.lastEvent };
}

/**
 * Prove delivery of the exact portal-login message for the event just created,
 * then recover its OTP from Resend's sent copy. The encrypted credential is
 * never read from application storage or exposed in deployed UI.
 */
export async function waitForPortalLoginDelivery(
  eventId: string,
  email: string,
  timeoutMs = 60_000,
): Promise<PortalLoginDelivery> {
  const delivered = await waitForDeliveredMessage(email, async () => {
    const [row] = await queryRows<OutboxDelivery>(`
      SELECT log.provider_message_id, log.status, log.error
      FROM communication_logs log
      JOIN contacts contact
        ON contact.id = log.contact_id
       AND contact.event_id = log.event_id
      WHERE log.event_id = $1
        AND log.template_key = 'portal_login'
        AND lower(contact.email) = lower($2)
      ORDER BY log.created_at DESC, log.id DESC
      LIMIT 1
    `, [eventId, email]);
    return row;
  }, "portal login", timeoutMs);
  const otp = delivered.message.html ? portalOtpFromHtml(delivered.message.html) : null;
  if (!otp) throw new Error(`portal login email ${delivered.providerMessageId} has no six-digit code`);
  return { otp, providerMessageId: delivered.providerMessageId, lastEvent: delivered.lastEvent };
}
