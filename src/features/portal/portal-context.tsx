"use client";

import { notFound } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { PortalSession } from "@/features/auth";
import { useDemo } from "@/shared/demo/demo-provider";
import { DEMO_SPEAKER_ID } from "@/shared/demo/seed";
import type { EventRecord, SpeakerRecord } from "@/shared/demo/types";

// Demo-mode portal session: the signed-in speaker defaults to the seeded demo
// speaker; "Open portal as" from the admin speakers page stores an
// impersonation id here. A real OTP session arrives as `serverShell` below.
export const PORTAL_SPEAKER_KEY = "openboard-portal-speaker";

/**
 * The portal chrome's own data, read from the database by the portal layout.
 *
 * Without it this provider resolved the event out of the browser demo fixture
 * by slug and `notFound()`ed when it was absent — which is every real event —
 * so a genuinely signed-in speaker saw the 404 page on every portal surface
 * while the page underneath had already loaded their real data.
 */
export type PortalShellData = { event: EventRecord; speaker: SpeakerRecord; openTaskCount: number };

type PortalContextValue = { event: EventRecord; speaker: SpeakerRecord; openTaskCount: number; impersonated: boolean; exitImpersonation: () => void };
const PortalContext = createContext<PortalContextValue | null>(null);

export function PortalProvider({ eventSlug, session, serverShell, children }: { eventSlug: string; session: PortalSession | null; serverShell?: PortalShellData; children: React.ReactNode }) {
  const { state, hydrated } = useDemo();
  const [impersonatedId, setImpersonatedId] = useState<string | null>(null);
  useEffect(() => {
    if (!session) setImpersonatedId(window.localStorage.getItem(PORTAL_SPEAKER_KEY));
  }, [session]);
  const demoEvent = state.events.find((item) => item.slug === eventSlug);
  const event = serverShell?.event ?? demoEvent;
  const speaker = useMemo(() => {
    if (serverShell) return serverShell.speaker;
    if (!event) return undefined;
    const requested = impersonatedId ? state.speakers.find((item) => item.id === impersonatedId && item.eventId === event.id) : undefined;
    return requested ?? state.speakers.find((item) => item.id === DEMO_SPEAKER_ID && item.eventId === event.id) ?? state.speakers.find((item) => item.eventId === event.id);
  }, [event, impersonatedId, serverShell, state.speakers]);
  if (!event || !speaker) {
    if (!hydrated) return null;
    notFound();
  }
  const value: PortalContextValue = {
    event, speaker,
    openTaskCount: serverShell?.openTaskCount ?? state.tasks.filter((task) => task.eventId === event.id && !state.completions.some((done) => done.taskId === task.id && done.speakerId === speaker.id)).length,
    impersonated: session ? session.impersonatedByUserId !== null : Boolean(impersonatedId && impersonatedId !== DEMO_SPEAKER_ID && impersonatedId === speaker.id),
    exitImpersonation: () => { window.localStorage.removeItem(PORTAL_SPEAKER_KEY); setImpersonatedId(null); },
  };
  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortal() {
  const value = useContext(PortalContext);
  if (!value) throw new Error("usePortal must be inside PortalProvider");
  return value;
}
