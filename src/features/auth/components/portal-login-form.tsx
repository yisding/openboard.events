"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { focusOnNextFrame } from "@/shared/ui/app/focus-on-transition";
import { Button } from "@/shared/ui/ui-kit";
import { OtpForm } from "./otp-form";
import { portalAuthRequest } from "./portal-auth-request";

type Fallback = { otp: string; magicLink: string };

/**
 * Why the code step is on screen. `sent` means this visit just minted a code;
 * `existing` means it did not — the speaker either said they already had one or
 * was throttled — and the copy must not claim otherwise.
 */
export type CodeStepOrigin = "sent" | "existing";

/**
 * The wait the limiter itself measured, as a sentence fragment. Rounded up to
 * whole minutes: `Retry-After: 453` is "about 8 minutes", not "453 seconds",
 * and a number that precise invites reloading the page to watch it.
 */
export function retryWindowHint(seconds: number | undefined): string {
  if (seconds === undefined || seconds <= 0) return "in a few minutes";
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "in about a minute" : `in about ${minutes} minutes`;
}

export function PortalCodeStep({ eventSlug, email, next, fallback, origin, retryAfterSeconds, headingRef, onUseDifferentEmail, onRequestNewCode, requesting }: {
  eventSlug: string;
  email: string;
  next?: string;
  fallback: Fallback | null;
  origin: CodeStepOrigin;
  retryAfterSeconds?: number;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onUseDifferentEmail: () => void;
  onRequestNewCode: () => void;
  requesting: boolean;
}) {
  return <>
    <h1 ref={headingRef} tabIndex={-1}>{origin === "sent" ? "Check your inbox" : "Enter your code"}</h1>
    {origin === "sent"
      // The throttled wording covers both people it can reach: the speaker who
      // has a code sitting in their inbox, and the one who never got that far
      // (the per-IP bucket refuses a shared network too). Neither is told a
      // code is waiting for them, and neither is left without a next move.
      ? <p>Enter the six-digit code sent to <b>{email}</b>.</p>
      : <p>If you already have a code for <b>{email}</b>, enter it below — it stays valid for 15 minutes. Otherwise request a new one {retryWindowHint(retryAfterSeconds)}.</p>}
    <OtpForm eventSlug={eventSlug} email={email} {...(next ? { next } : {})} />
    {fallback && <aside className="demo-code"><b>Test environment</b><span>Your one-time code: <code>{fallback.otp}</code></span><Link href={fallback.magicLink}>Continue with a sign-in link</Link></aside>}
    {origin === "existing" && <button className="text-button" type="button" disabled={requesting} onClick={onRequestNewCode}>{requesting ? "Sending…" : "Send a new code"}</button>}
    <button className="text-button" type="button" onClick={onUseDifferentEmail}>Use a different email</button>
  </>;
}

export function PortalLoginForm({ eventSlug, next }: { eventSlug: string; next?: string }) {
  const [email, setEmail] = useState("");
  const [origin, setOrigin] = useState<CodeStepOrigin | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | undefined>(undefined);
  const [fallback, setFallback] = useState<Fallback | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const requestedHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!origin) return;
    return focusOnNextFrame(requestedHeadingRef);
  }, [origin]);

  async function sendCode(value: string) {
    setPending(true);
    setError("");
    try {
      const result = await portalAuthRequest("/api/internal/auth/portal/request", { eventSlug, email: value, ...(next ? { next } : {}) });
      if (!result.ok) {
        // A 429 is the one failure that must not end the flow. The code the
        // speaker is holding — the reason the limiter refused to mint another —
        // is still the credential that signs them in, and the field for it only
        // exists on the next step. Move them to it rather than leaving them on
        // a form whose only button re-triggers the same refusal.
        if (result.status === 429) {
          setFallback(null);
          setRetryAfterSeconds(result.retryAfterSeconds);
          setOrigin("existing");
          return;
        }
        setError(result.status === null
          ? "We couldn't reach the server — check your connection and try again"
          : "We couldn't send a code right now");
        return;
      }
      setFallback(result.data.fallback ?? null);
      setRetryAfterSeconds(undefined);
      setOrigin("sent");
    } finally {
      setPending(false);
    }
  }

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim().toLowerCase();
    setEmail(value);
    await sendCode(value);
  }

  /**
   * The escape hatch for a code that arrived before this page did — a speaker
   * who closed the tab, or followed the email on another device. Requesting a
   * fresh one would consume throttle budget and invalidate the code they are
   * holding, so this step deliberately sends nothing.
   */
  function useExistingCode() {
    const field = emailInput.current;
    if (field && !field.reportValidity()) return;
    setEmail(email.trim().toLowerCase());
    setError("");
    setFallback(null);
    setRetryAfterSeconds(undefined);
    setOrigin("existing");
  }

  if (origin) return <PortalCodeStep
    eventSlug={eventSlug}
    email={email}
    {...(next ? { next } : {})}
    fallback={fallback}
    origin={origin}
    {...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })}
    headingRef={requestedHeadingRef}
    requesting={pending}
    onRequestNewCode={() => { void sendCode(email); }}
    onUseDifferentEmail={() => setOrigin(null)}
  />;

  return <form onSubmit={requestCode}>
    <h1>Speaker portal</h1>
    <p>Enter your email to receive a one-time code and secure sign-in link.</p>
    <label className="field"><span>Email address</span><input ref={emailInput} autoFocus name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    {error && <p className="field-error" role="alert">{error}</p>}
    <Button disabled={pending} type="submit">{pending ? "Sending…" : "Send sign-in code"}</Button>
    <button className="text-button" type="button" onClick={useExistingCode}>I already have a code</button>
  </form>;
}
