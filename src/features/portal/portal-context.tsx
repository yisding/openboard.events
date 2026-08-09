"use client";

import { notFound } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { PortalSession } from "@/features/auth";
import { useDemo } from "@/shared/demo/demo-provider";
import { DEMO_SPEAKER_ID } from "@/shared/demo/seed";
import type { EventRecord, SpeakerRecord } from "@/shared/demo/types";

// Demo-mode portal session: the signed-in speaker defaults to the seeded demo
// speaker; "Open portal as" from the admin speakers page stores an
// impersonation id here. Real OTP portal auth arrives with M06b.
export const PORTAL_SPEAKER_KEY = "openboard-portal-speaker";

type PortalContextValue = { event: EventRecord; speaker: SpeakerRecord; impersonated: boolean; exitImpersonation: () => void };
const PortalContext = createContext<PortalContextValue | null>(null);

export function PortalProvider({ eventSlug, session, children }: { eventSlug: string; session: PortalSession | null; children: React.ReactNode }) {
  const { state, hydrated } = useDemo();
  const [impersonatedId, setImpersonatedId] = useState<string | null>(null);
  useEffect(() => {
    if (!session) setImpersonatedId(window.localStorage.getItem(PORTAL_SPEAKER_KEY));
  }, [session]);
  const event = state.events.find((item) => item.slug === eventSlug);
  const speaker = useMemo(() => {
    if (!event) return undefined;
    if (session) {
      const normalizedEmail = session.email.trim().toLowerCase();
      return state.speakers.find((item) => item.eventId === event.id && (item.id === session.contactId || item.email.trim().toLowerCase() === normalizedEmail)) ?? {
        id: session.contactId,
        eventId: event.id,
        firstName: normalizedEmail.split("@", 1)[0] || "Speaker",
        lastName: "",
        email: session.email,
        company: "",
        title: "",
        bio: "",
        location: "",
        website: "",
        linkedin: "",
        avatar: normalizedEmail.slice(0, 2).toUpperCase() || "SP",
        avatarColor: "#6958d7",
        confirmation: "confirmed",
        profileCompletion: 0,
        tags: [],
      } satisfies SpeakerRecord;
    }
    const requested = impersonatedId ? state.speakers.find((item) => item.id === impersonatedId && item.eventId === event.id) : undefined;
    return requested ?? state.speakers.find((item) => item.id === DEMO_SPEAKER_ID && item.eventId === event.id) ?? state.speakers.find((item) => item.eventId === event.id);
  }, [event, impersonatedId, session, state.speakers]);
  if (!event || !speaker) {
    if (!hydrated) return null;
    notFound();
  }
  const value: PortalContextValue = {
    event, speaker,
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
