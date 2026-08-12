"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCircle2, LogIn, Users } from "lucide-react";
import { z } from "zod";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";

const acceptedSchema = z.object({ organizationId: z.string(), role: z.string() });

type Status = "checking" | "signed-out" | "accepting" | "accepted" | "error";

/**
 * M44 — the landing page for a team-invitation link (`invite.action_url` in
 * `organization_invited`'s mail). No page-level auth gate: unlike every
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
    return <div><span className="metric-icon accent"><Users size={20} /></span><h1>Checking your invitation…</h1></div>;
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
      <p>The invitation was accepted. Continue straight to your new workspace.</p>
      <a className="button button-primary button-lg" href={`/organizations/${encodeURIComponent(organizationId)}`}>Continue <LogIn size={16} /></a>
    </div>;
  }

  return <div>
    <h1>This invitation isn&apos;t valid</h1>
    <p>{message || "It may have expired or already been used. Ask whoever invited you to send a new one."}</p>
  </div>;
}
