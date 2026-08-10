"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { eventDtoSchema, type EventDTO, type EventId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { formatInZone } from "@/shared/lib/time";

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words[0]?.[0] ?? "?").toUpperCase() + (words[1]?.[0] ?? "").toUpperCase();
}

/**
 * A `listEvents()`-backed popover for the admin sidebar. Self-contained: it
 * fetches its own list rather than requiring a server-rendered prop, since
 * the shell that eventually mounts this (M05a's sidebar slot) does not own
 * this feature's data fetching.
 */
export function EventSwitcher({ eventId }: { eventId: EventId }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<EventDTO[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || events) return;
    void api("events", z.array(eventDtoSchema)).then(setEvents).catch(() => setEvents([]));
  }, [open, events]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const current = events?.find((event) => event.id === eventId);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button type="button" className="event-switcher" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="event-switcher-mark">{initials(current?.name ?? "…")}</span>
        <span>
          <b>{current?.name ?? "Choose an event"}</b>
          {current && <small>{formatInZone(current.startsAt, current.timezone, "date")}</small>}
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: 260, maxHeight: 320, overflowY: "auto",
            background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "var(--shadow)", zIndex: 40, padding: 6,
          }}
        >
          {events === null && <div style={{ padding: 10, fontSize: 10, color: "var(--muted)" }}>Loading…</div>}
          {events?.length === 0 && <div style={{ padding: 10, fontSize: 10, color: "var(--muted)" }}>No events yet</div>}
          {events?.map((event) => (
            <Link
              key={event.id}
              href={`/events/${event.id}/dashboard`}
              onClick={() => setOpen(false)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 7, textDecoration: "none",
                color: "var(--ink)", background: event.id === eventId ? "var(--fill)" : "transparent",
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 700 }}>{initials(event.name)}</span>
              <span style={{ display: "grid" }}>
                <b style={{ fontSize: 10 }}>{event.name}</b>
                <small style={{ fontSize: 8, color: "var(--muted)" }}>
                  {formatInZone(event.startsAt, event.timezone, "date")} – {formatInZone(event.endsAt, event.timezone, "date")}
                </small>
              </span>
            </Link>
          ))}
          <Link
            href="/events/new"
            onClick={() => setOpen(false)}
            style={{ display: "block", marginTop: 6, padding: "8px 10px", borderTop: "1px solid var(--line)", fontSize: 9, fontWeight: 700, color: "var(--accent-dark)", textDecoration: "none" }}
          >
            + Create event
          </Link>
        </div>
      )}
    </div>
  );
}
