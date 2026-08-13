"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function LandingMobileNav({ cfpHref, showSignIn }: { cfpHref: string; showSignIn: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const dismissOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", dismissOutside);
    return () => {
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", dismissOutside);
    };
  }, [open]);

  return (
    <div className="landing-mobile-nav" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        aria-controls="landing-mobile-links"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>
      {open && (
        <div id="landing-mobile-links" className="landing-mobile-links">
          <a href="#features" onClick={() => setOpen(false)}>Platform</a>
          <a href="#story" onClick={() => setOpen(false)}>Why Openboard</a>
          <Link href={cfpHref} onClick={() => setOpen(false)}>View sample CFP</Link>
          {showSignIn && <Link href="/login" onClick={() => setOpen(false)}>Sign in</Link>}
        </div>
      )}
    </div>
  );
}
