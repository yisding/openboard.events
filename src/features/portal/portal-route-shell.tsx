"use client";

import { usePathname } from "next/navigation";
import { PortalProvider } from "./portal-context";
import { PortalShell } from "./portal-shell";

export function PortalRouteShell({ eventSlug, children }: { eventSlug: string; children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.endsWith("/login") || pathname.endsWith("/verify")) return children;
  return <PortalProvider eventSlug={eventSlug}><PortalShell>{children}</PortalShell></PortalProvider>;
}
