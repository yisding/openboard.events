"use client";

import Link from "next/link";
import { Eye } from "lucide-react";

export function ImpersonationBanner({ name, email, backHref }: { name: string; email: string; backHref: string }) {
  return <div className="impersonation-banner"><Eye size={14} /><span>Viewing as <b>{name}</b> ({email})</span><Link href={backHref}>Back to Admin</Link></div>;
}
