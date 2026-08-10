import { AppError } from "@/shared/lib/errors";

export type EmailMessage = {
  apiKey: string;
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  attachments?: Array<{ filename: string; content: string; content_type: string }>;
  /** P3-EMAIL: `List-Unsubscribe` on non-transactional sends — see `isTransactionalTemplate`. */
  headers?: Record<string, string>;
};

export async function sendViaResend(message: EmailMessage, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${message.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": message.idempotencyKey,
    },
    body: JSON.stringify({
      from: message.from,
      to: [message.to],
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.attachments ? { attachments: message.attachments } : {}),
      ...(message.headers ? { headers: message.headers } : {}),
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new AppError("INTERNAL", `email provider ${response.status}: ${body.slice(0, 500)}`);
  let id: unknown;
  try {
    id = (JSON.parse(body) as { id?: unknown }).id;
  } catch {
    throw new AppError("INTERNAL", "email provider returned invalid JSON");
  }
  if (typeof id !== "string" || !id) throw new AppError("INTERNAL", "email provider response is missing an id");
  return id;
}
