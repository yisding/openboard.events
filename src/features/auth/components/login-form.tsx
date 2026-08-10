"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
import { safeInternalPath } from "../safe-next";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
      });
      if (!response.ok) {
        setError("Invalid email or password");
        return;
      }
      router.replace(safeInternalPath(searchParams.get("next")));
      router.refresh();
    } catch {
      setError("Sign-in is temporarily unavailable");
    } finally {
      setPending(false);
    }
  }

  return <form onSubmit={submit}>
    <span className="metric-icon accent"><LockKeyhole size={20} /></span>
    <h1>Welcome back</h1>
    <p>Sign in to your Openboard workspace.</p>
    <label className="field"><span>Email address</span><div className="input-icon"><Mail size={16} /><input name="email" autoComplete="email" required type="email" /></div></label>
    <label className="field"><span>Password</span><input name="password" autoComplete="current-password" required minLength={8} type="password" /></label>
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="button button-primary button-lg" disabled={pending} type="submit">{pending ? "Signing in…" : "Sign in"} <ArrowRight size={16} /></button>
    {/* The only route into M42's reset flow. `/login/reset` is where the
        emailed link lands; `/login/forgot` is what causes it to be sent. */}
    <p><Link href="/login/forgot">Forgot your password?</Link></p>
  </form>;
}
