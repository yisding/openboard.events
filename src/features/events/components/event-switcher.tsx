"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { eventDtoSchema, type EventDTO, type EventId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { formatInZone } from "@/shared/lib/time";

type SwitcherEvent = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
};

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
export function EventSwitcher({
  eventId,
  initialEvent,
  demoEvents,
}: {
  eventId: EventId;
  initialEvent?: { name: string; detail: string };
  demoEvents?: SwitcherEvent[];
}) {
  const [open, setOpen] = useState(false);
  const [remoteEvents, setRemoteEvents] = useState<EventDTO[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const events = demoEvents ?? remoteEvents;

  useEffect(() => {
    if (demoEvents || !open || remoteEvents) return;
    let cancelled = false;
    void api("events", z.array(eventDtoSchema))
      .then((nextEvents) => {
        if (!cancelled) setRemoteEvents(nextEvents);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Events couldn't be loaded. Check your connection and try again.");
      });
    return () => { cancelled = true; };
  }, [demoEvents, loadAttempt, open, remoteEvents]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const current = events?.find((event) => event.id === eventId);
  const currentName = current?.name ?? initialEvent?.name ?? "Choose an event";
  const currentDetail = current
    ? formatInZone(current.startsAt, current.timezone, "date")
    : initialEvent?.detail;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button ref={triggerRef} type="button" className="event-switcher" onClick={() => {
        if (!open && loadError) setLoadError("");
        setOpen((value) => !value);
      }} aria-expanded={open} aria-haspopup="menu" aria-controls={menuId}>
        <span className="event-switcher-mark">{initials(currentName)}</span>
        <span>
          <b>{currentName}</b>
          {currentDetail && <small>{currentDetail}</small>}
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: 260, maxHeight: 320, overflowY: "auto",
            background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "var(--shadow)", zIndex: 40, padding: 6,
          }}
        >
          {events === null && !loadError && <div style={{ padding: 10, fontSize: 11.5, color: "var(--muted)" }}>Loading…</div>}
          {events === null && loadError && (
            <div role="alert" style={{ display: "grid", gap: 8, padding: 10, fontSize: 11.5, color: "var(--muted)" }}>
              <span>{loadError}</span>
              <button type="button" className="text-button" onClick={() => {
                setLoadError("");
                setLoadAttempt((attempt) => attempt + 1);
              }}>Retry</button>
            </div>
          )}
          {events?.length === 0 && <div style={{ padding: 10, fontSize: 11.5, color: "var(--muted)" }}>No events yet</div>}
          {events?.map((event) => (
            <Link
              key={event.id}
              href={`/events/${event.id}/dashboard`}
              role="menuitem"
              onClick={() => setOpen(false)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 7, textDecoration: "none",
                color: "var(--ink)", background: event.id === eventId ? "var(--fill)" : "transparent",
              }}
            >
              <span style={{ fontSize: 11.5, fontWeight: 700 }}>{initials(event.name)}</span>
              <span style={{ display: "grid" }}>
                <b style={{ fontSize: 11.5 }}>{event.name}</b>
                <small style={{ fontSize: 10, color: "var(--muted)" }}>
                  {formatInZone(event.startsAt, event.timezone, "date")} – {formatInZone(event.endsAt, event.timezone, "date")}
                </small>
              </span>
            </Link>
          ))}
          <Link
            href={demoEvents ? "/events" : "/events/new"}
            role="menuitem"
            onClick={() => setOpen(false)}
            style={{ display: "block", marginTop: 6, padding: "8px 10px", borderTop: "1px solid var(--line)", fontSize: 11, fontWeight: 700, color: "var(--accent-dark)", textDecoration: "none" }}
          >
            {demoEvents ? "All events" : "+ Create event"}
          </Link>
        </div>
      )}
    </div>
  );
}
