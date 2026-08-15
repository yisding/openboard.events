"use client";

import { CalendarPlus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

/**
 * M59 — mints the `ics_download` token on click (see the route's own doc
 * comment for why not at render time) and hands the browser the resulting
 * `/cal/[token]` URL, exactly the feed a calendar app's "subscribe by URL"
 * expects.
 */
export function AddToCalendarButton({ eventId }: { eventId: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function subscribe() {
    setBusy(true);
    try {
      const response = await fetch(`/api/internal/portal/calendar?eventId=${encodeURIComponent(eventId)}`, { method: "POST" });
      const payload = await response.json().catch(() => null) as { data?: { url: string } } | null;
      if (!response.ok || !payload?.data) {
        toast("Could not open your calendar feed — try again", { kind: "error" });
        return;
      }
      globalThis.location.href = payload.data.url;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" size="sm" disabled={busy} onClick={() => void subscribe()}>
      <CalendarPlus size={14} /> {busy ? "Opening…" : "Subscribe to my schedule"}
    </Button>
  );
}
