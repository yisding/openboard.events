"use client";

import { usePathname } from "next/navigation";
import type { PortalSession } from "@/features/auth";
import { PortalProvider } from "./portal-context";
import { PortalShell } from "./portal-shell";

export function PortalRouteShell({ eventSlug, session, children }: { eventSlug: string; session: PortalSession | null; children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.endsWith("/login") || pathname.endsWith("/verify")) return children;
  return <PortalProvider eventSlug={eventSlug} session={session}><PortalShell>{children}</PortalShell></PortalProvider>;
}
