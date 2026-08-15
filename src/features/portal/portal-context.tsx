"use client";

import { createContext, useContext } from "react";
import type { PortalSession } from "@/features/auth";
import type { EventRecord, SpeakerRecord } from "./types";

/**
 * The portal chrome's own data, read from the database by the portal layout.
 *
 * It is the provider's only data source: every portal surface renders for the
 * speaker the session vouches for, and a request that cannot produce a shell
 * never reaches this provider — the layout redirects to the portal login
 * first.
 */
export type PortalShellData = { event: EventRecord; speaker: SpeakerRecord; openTaskCount: number };

/** The admin behind an impersonated session, resolved server-side from `impersonatedByUserId`. */
export type PortalImpersonator = { name: string; email: string };

type PortalContextValue = {
  event: EventRecord;
  speaker: SpeakerRecord;
  openTaskCount: number;
  impersonated: boolean;
  impersonator: PortalImpersonator | null;
};
const PortalContext = createContext<PortalContextValue | null>(null);

export function PortalProvider({ session, serverShell, impersonator = null, children }: {
  session: PortalSession | null;
  serverShell: PortalShellData;
  impersonator?: PortalImpersonator | null;
  children: React.ReactNode;
}) {
  const value: PortalContextValue = {
    event: serverShell.event,
    speaker: serverShell.speaker,
    openTaskCount: serverShell.openTaskCount,
    // Impersonation is a property of the session row an organizer minted, not
    // of anything the browser can set for itself.
    impersonated: session !== null && session.impersonatedByUserId !== null,
    impersonator,
  };
  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortal() {
  const value = useContext(PortalContext);
  if (!value) throw new Error("usePortal must be inside PortalProvider");
  return value;
}
