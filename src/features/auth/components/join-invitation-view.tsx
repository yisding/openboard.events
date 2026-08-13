"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, LogIn, Users } from "lucide-react";
import { z } from "zod";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";

const acceptedSchema = z.object({ organizationId: z.string(), role: z.string(), eventId: z.string().nullable() });

type Status = "checking" | "signed-out" | "accepting" | "accepted" | "error";

/**
 * M44/M61 — the landing page for a workspace or reviewer invitation link. No
 * page-level auth gate: unlike every
 * `/events/…`/`/organizations/…` surface, arriving here signed out is the
 * expected first visit, not an error — the invitation itself is the
 * credential that is missing an identity to attach to, not the reverse.
 */
export function JoinInvitationView() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<Status>("checking");
  const [message, setMessage] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [eventId, setEventId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("This invitation link is incomplete.");
      return;
    }
    let cancelled = false;
    (async () => {
      setStatus("accepting");
      try {
        const result = await api("organizations/invitations/accept", acceptedSchema, { method: "POST", body: { token } });
        if (cancelled) return;
        setOrganizationId(result.organizationId);
        setEventId(result.eventId);
        setStatus("accepted");
      } catch (caught) {
        if (cancelled) return;
        if (isAppError(caught) && caught.code === "UNAUTHORIZED") {
          setStatus("signed-out");
          return;
        }
        setStatus("error");
        setMessage(isAppError(caught) ? caught.message : "That invitation could not be accepted");
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const next = `/join?token=${encodeURIComponent(token)}`;

  if (status === "checking" || status === "accepting") {
    return <div role="status" aria-live="polite"><span className="metric-icon accent"><Users size={20} /></span><h1>Checking your invitation…</h1></div>;
  }

  if (status === "signed-out") {
    return <div>
      <span className="metric-icon accent"><LogIn size={20} /></span>
      <h1>Sign in to accept</h1>
      <p>Sign in or create an account with the email this invitation was sent to.</p>
      <a className="button button-primary button-lg" href={`/login?next=${encodeURIComponent(next)}`}>Sign in <LogIn size={16} /></a>
      <p><a href={`/signup?next=${encodeURIComponent(next)}`}>New here? Create an account</a></p>
    </div>;
  }

  if (status === "accepted") {
    return <div>
      <span className="metric-icon accent"><CheckCircle2 size={20} /></span>
      <h1>You&apos;re in</h1>
      <p>{eventId ? "The invitation was accepted. Your review queue is ready." : "The invitation was accepted. Continue straight to your new workspace."}</p>
      <a className="button button-primary button-lg" href={eventId ? `/events/${encodeURIComponent(eventId)}/review` : `/organizations/${encodeURIComponent(organizationId)}`}>{eventId ? "Open review queue" : "Continue"} <LogIn size={16} /></a>
    </div>;
  }

  return <div>
    <span className="metric-icon amber"><CircleAlert size={20} /></span>
    <h1>This invitation isn&apos;t valid</h1>
    <p>{message || "It may have expired or already been used. Ask whoever invited you to send a new one."}</p>
    <a className="button button-secondary button-lg" href="/login">Go to sign in <LogIn size={16} /></a>
  </div>;
}
