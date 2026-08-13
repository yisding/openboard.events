import { BellOff, CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import { canUnsubscribeFromReminders } from "@/features/comms/server/unsubscribe";
import { Brand } from "@/shared/ui/brand";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Email preferences" };

export default async function UnsubscribePage({ params, searchParams }: {
  params: Promise<{ eventSlug: string }>;
  searchParams: Promise<{ token?: string; done?: string }>;
}) {
  const { eventSlug } = await params;
  const { token = "", done } = await searchParams;
  if (done === "1") return <main className="login-page"><section className="login-card"><div className="login-card__brand"><Brand /></div><div className="empty-state"><div className="empty-icon"><CheckCircle2 size={24} /></div><h1>Non-essential emails stopped</h1><p>You won’t receive any more reminders or other non-essential emails for this event. You’ll still get decision, schedule, and sign-in emails.</p></div></section></main>;
  const valid = token.length > 0 && await canUnsubscribeFromReminders(eventSlug, token);
  return <main className="login-page"><section className="login-card"><div className="login-card__brand"><Brand /></div><div className="empty-state"><div className="empty-icon"><BellOff size={24} /></div><h1>{valid ? "Stop non-essential emails?" : "This unsubscribe link is invalid"}</h1><p>{valid ? "You’ll still get decision, schedule, and sign-in emails — just no more reminders or other non-essential mail. You can still sign in to the speaker portal and complete your tasks." : "The link may have expired. Contact the event organizer if you need help."}</p>{valid && <form action={`/portal/${encodeURIComponent(eventSlug)}/unsubscribe/confirm`} method="post"><input type="hidden" name="token" value={token} /><button className="button button-primary" type="submit">Unsubscribe from non-essential emails</button></form>}</div></section></main>;
}
