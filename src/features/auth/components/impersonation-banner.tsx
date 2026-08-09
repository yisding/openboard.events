"use client";

import Link from "next/link";
import { Eye } from "lucide-react";

export function ImpersonationBanner({ name, email, backHref, onExit }: { name: string; email: string; backHref: string; onExit?: () => void }) {
  return <div className="impersonation-banner"><Eye size={14} /><span>Viewing as <b>{name}</b> ({email})</span><Link href={backHref} {...(onExit ? { onClick: onExit } : {})}>Back to Admin</Link></div>;
}
