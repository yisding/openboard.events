"use client";

import { usePathname } from "next/navigation";
import type { PortalSession } from "@/features/auth";
import { PortalProvider, type PortalShellData } from "./portal-context";
import { PortalShell } from "./portal-shell";

export function PortalRouteShell({ session, shell, children }: { session: PortalSession | null; shell: PortalShellData; children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.endsWith("/login") || pathname.endsWith("/verify")) return children;
  return <PortalProvider session={session} serverShell={shell}><PortalShell>{children}</PortalShell></PortalProvider>;
}
