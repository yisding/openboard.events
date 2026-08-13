"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { eventAccessDtoSchema, type EventAccessDTO, type EventId, type MemberRole } from "@/shared/contracts";
import { eventManagementHref } from "@/features/events/access";
import { eventLifecycle, orderEventsByLifecycle } from "@/features/events/event-lifecycle";
import { api } from "@/shared/lib/api-client";
import { formatDateRangeInZone, formatInZone } from "@/shared/lib/time";

type SwitcherEvent = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  role?: MemberRole;
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
  canCreateEvent,
  nowIso,
  defaultOpen = false,
}: {
  eventId: EventId;
  initialEvent?: { name: string; detail: string };
  demoEvents?: SwitcherEvent[];
  canCreateEvent: boolean;
  nowIso: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [remoteEvents, setRemoteEvents] = useState<EventAccessDTO[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [lifecycleNowIso, setLifecycleNowIso] = useState(nowIso);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const events = demoEvents ?? remoteEvents;
  const orderedEvents = events ? orderEventsByLifecycle(events, lifecycleNowIso) : events;

  useEffect(() => {
    if (demoEvents || !open || remoteEvents) return;
    let cancelled = false;
    void api("events", z.array(eventAccessDtoSchema))
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

  const current = orderedEvents?.find((event) => event.id === eventId);
  const currentName = current?.name ?? initialEvent?.name ?? "Choose an event";
  const currentDetail = current
    ? formatInZone(current.startsAt, current.timezone, "date")
    : initialEvent?.detail;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button ref={triggerRef} type="button" className="event-switcher" onClick={() => {
        if (!open) {
          setLifecycleNowIso(new Date().toISOString());
          if (loadError) setLoadError("");
        }
        setOpen((value) => !value);
      }} aria-expanded={open} aria-controls={menuId}>
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
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: 260, maxHeight: 320, overflowY: "auto",
            background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "var(--shadow)", zIndex: 40, padding: 6,
          }}
        >
          {orderedEvents === null && !loadError && <div style={{ padding: 12, fontSize: 11.5, color: "var(--muted)" }}>Loading…</div>}
          {orderedEvents === null && loadError && (
            <div role="alert" style={{ display: "grid", gap: 8, padding: 12, fontSize: 11.5, color: "var(--muted)" }}>
              <span>{loadError}</span>
              <button type="button" className="text-button" onClick={() => {
                setLoadError("");
                setLoadAttempt((attempt) => attempt + 1);
              }}>Retry</button>
            </div>
          )}
          {orderedEvents?.length === 0 && <div style={{ padding: 12, fontSize: 11.5, color: "var(--muted)" }}>No events yet</div>}
          {orderedEvents?.map((event) => (
            <Link
              key={event.id}
              className={`event-switcher-option is-${eventLifecycle(event, lifecycleNowIso)}`}
              href={eventManagementHref(event.id as EventId, event.role ?? "organizer") ?? "/events"}
              aria-current={event.id === eventId ? "page" : undefined}
              onClick={() => setOpen(false)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 7, textDecoration: "none",
                color: "var(--ink)", background: event.id === eventId ? "var(--fill)" : "transparent",
              }}
            >
              <span style={{ fontSize: 11.5, fontWeight: 700 }}>{initials(event.name)}</span>
              <span style={{ display: "grid" }}>
                <b style={{ fontSize: 11.5 }}>{event.name}</b>
                <small style={{ fontSize: 10, color: "var(--muted)" }}>
                  {formatDateRangeInZone(event.startsAt, event.endsAt, event.timezone)}
                </small>
              </span>
            </Link>
          ))}
          <Link
            href={demoEvents || !canCreateEvent ? "/events" : "/organizations?intent=create-event"}
            onClick={() => setOpen(false)}
            style={{ display: "block", marginTop: 6, padding: "8px 12px", borderTop: "1px solid var(--line)", fontSize: 11, fontWeight: 600, color: "var(--accent-dark)", textDecoration: "none" }}
          >
            {demoEvents || !canCreateEvent ? "All events" : "+ Create event"}
          </Link>
        </div>
      )}
    </div>
  );
}
