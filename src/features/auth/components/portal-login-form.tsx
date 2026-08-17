"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { focusOnNextFrame } from "@/shared/ui/app/focus-on-transition";
import { Button } from "@/shared/ui/ui-kit";
import { OtpForm } from "./otp-form";
import { portalAuthRequest } from "./portal-auth-request";

type Fallback = { otp: string; magicLink: string };

/**
 * Why the code step is on screen, because the three answers are three different
 * sentences. `sent` minted a code just now. `existing` is the speaker saying
 * they already hold one, so nothing was sent and nothing is being waited for.
 * `throttled` is the refusal: no code was minted, and there is a measured wait
 * before one can be. Only `throttled` may talk about waiting.
 */
export type CodeStepOrigin = "sent" | "existing" | "throttled";

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

function codeStepIntro(origin: CodeStepOrigin, email: string, retryAfterSeconds: number | undefined) {
  if (origin === "sent") return <p>Enter the six-digit code sent to <b>{email}</b>.</p>;
  if (origin === "existing") return <p>Enter the six-digit code we sent to <b>{email}</b>. Codes stay valid for 15 minutes — ask for a new one below if yours has run out.</p>;
  // The refusal has to serve both people it can reach: the speaker with a code
  // sitting in their inbox, and the one who never got that far, because the
  // per-IP bucket refuses a shared network too. Neither is told a code is
  // waiting for them, and neither is left without a next move.
  return <p>We can’t send another code to <b>{email}</b> yet. If you already have one it still works; otherwise ask again {retryWindowHint(retryAfterSeconds)}.</p>;
}

export function PortalCodeStep({ eventSlug, email, next, fallback, origin, retryAfterSeconds, error, headingRef, onUseDifferentEmail, onRequestNewCode, requesting }: {
  eventSlug: string;
  email: string;
  next?: string;
  fallback: Fallback | null;
  origin: CodeStepOrigin;
  retryAfterSeconds?: number;
  error?: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onUseDifferentEmail: () => void;
  onRequestNewCode: () => void;
  requesting: boolean;
}) {
  return <>
    <h1 ref={headingRef} tabIndex={-1}>{origin === "sent" ? "Check your inbox" : "Enter your code"}</h1>
    {codeStepIntro(origin, email, retryAfterSeconds)}
    <OtpForm eventSlug={eventSlug} email={email} {...(next ? { next } : {})} />
    {fallback && <aside className="demo-code"><b>Test environment</b><span>Your one-time code: <code>{fallback.otp}</code></span><Link href={fallback.magicLink}>Continue with a sign-in link</Link></aside>}
    {/* The resend has its own failure to report and no form of its own to
        report it in — without this it would flip back from "Sending…" to
        "Send a new code" and say nothing at all. */}
    {error && <p className="field-error" role="alert">{error}</p>}
    {origin !== "sent" && <button className="text-button" type="button" disabled={requesting} onClick={onRequestNewCode}>{requesting ? "Sending…" : "Send a new code"}</button>}
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

  // Normalizing here rather than at each call site is what keeps the address
  // this posts, the address the code step names, and the address the verify
  // step spends the code against the same one string.
  async function sendCode(address: string) {
    const value = address.trim().toLowerCase();
    setEmail(value);
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
          setOrigin("throttled");
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
    await sendCode(email);
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
    {...(error ? { error } : {})}
    headingRef={requestedHeadingRef}
    requesting={pending}
    onRequestNewCode={() => { void sendCode(email); }}
    onUseDifferentEmail={() => { setError(""); setOrigin(null); }}
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
