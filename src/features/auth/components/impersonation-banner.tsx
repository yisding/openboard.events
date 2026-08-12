"use client";

import Link from "next/link";
import { Eye } from "lucide-react";
import { useRouter } from "next/navigation";
import { useGuardedAction } from "@/shared/ui/app/unsaved-work-guard";

export function ImpersonationBanner({ name, email, backHref, onExit }: { name: string; email: string; backHref: string; onExit?: () => void }) {
  const router = useRouter();
  const { runGuarded, allowNextNavigation } = useGuardedAction();
  return <div className="impersonation-banner"><Eye size={14} /><span>Viewing as <b>{name}</b> ({email})</span><Link href={backHref} data-unsaved-guard-owned onClick={(event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    runGuarded(() => allowNextNavigation(() => {
      onExit?.();
      router.push(backHref);
    }, { destination: backHref }));
  }}>Back to Admin</Link></div>;
}
