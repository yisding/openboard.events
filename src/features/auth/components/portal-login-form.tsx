"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { focusOnNextFrame } from "@/shared/ui/app/focus-on-transition";
import { Button } from "@/shared/ui/ui-kit";
import { OtpForm } from "./otp-form";
import { portalAuthRequest } from "./portal-auth-request";

type Fallback = { otp: string; magicLink: string };

export function PortalCodeStep({ eventSlug, email, next, fallback, headingRef, onUseDifferentEmail }: {
  eventSlug: string;
  email: string;
  next?: string;
  fallback: Fallback | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onUseDifferentEmail: () => void;
}) {
  return <>
    <h1 ref={headingRef} tabIndex={-1}>Check your inbox</h1>
    <p>Enter the six-digit code sent to <b>{email}</b>.</p>
    <OtpForm eventSlug={eventSlug} email={email} {...(next ? { next } : {})} />
    {fallback && <aside className="demo-code"><b>Development / fallback mode</b><span>Code <code>{fallback.otp}</code></span><Link href={fallback.magicLink}>Open magic link</Link></aside>}
    <button className="text-button" type="button" onClick={onUseDifferentEmail}>Use a different email</button>
  </>;
}

export function PortalLoginForm({ eventSlug, next }: { eventSlug: string; next?: string }) {
  const [email, setEmail] = useState("");
  const [requested, setRequested] = useState(false);
  const [fallback, setFallback] = useState<Fallback | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const requestedHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!requested) return;
    return focusOnNextFrame(requestedHeadingRef);
  }, [requested]);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const value = email.trim().toLowerCase();
    setEmail(value);
    try {
      const result = await portalAuthRequest("/api/internal/auth/portal/request", { eventSlug, email: value, ...(next ? { next } : {}) });
      if (!result.ok) {
        setError(result.status === 429
          ? "Check your inbox, or try again in a few minutes"
          : result.status === null
            ? "We couldn't reach the server — check your connection and try again"
            : "We couldn't send a code right now");
        return;
      }
      setFallback(result.data.fallback ?? null);
      setRequested(true);
    } finally {
      setPending(false);
    }
  }

  if (requested) return <PortalCodeStep eventSlug={eventSlug} email={email} {...(next ? { next } : {})} fallback={fallback} headingRef={requestedHeadingRef} onUseDifferentEmail={() => setRequested(false)} />;

  return <form onSubmit={requestCode}>
    <h1>Speaker portal</h1>
    <p>Enter your email to receive a one-time code and secure sign-in link.</p>
    <label className="field"><span>Email address</span><input autoFocus name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    {error && <p className="field-error" role="alert">{error}</p>}
    <Button disabled={pending} type="submit">{pending ? "Sending…" : "Send sign-in code"}</Button>
  </form>;
}
