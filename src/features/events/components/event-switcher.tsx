"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { eventAccessDtoSchema, type EventAccessDTO, type EventId, type MemberRole } from "@/shared/contracts";
import { eventManagementHref } from "@/features/events/access";
import { eventLifecycle, orderEventsByLifecycle } from "@/features/events/event-lifecycle";
import { api } from "@/shared/lib/api-client";
import { StatusBadge } from "@/shared/ui/ui-kit";
import { formatDateRangeInZone, formatInZone } from "@/shared/lib/time";

type SwitcherEvent = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  role?: MemberRole;
  /** First Fair (design §5.1). Optional here because the pre-supplied
   * kitchen-sink fixture rows are a hand-written subset; the live rows this
   * component fetches carry it for real, from `eventAccessDtoSchema`'s own
   * additive field. `EventDTO` itself stays frozen and knows nothing about
   * demos. */
  isDemo?: boolean;
};

/** One reader for both row shapes: the fixture's optional flag and the live DTO's. */
function rowIsDemo(row: SwitcherEvent | EventAccessDTO): boolean {
  return row.isDemo === true;
}

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
  const orderedEvents = events
    ? orderEventsByLifecycle<SwitcherEvent | EventAccessDTO>(events, lifecycleNowIso)
    : events;

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
    <div ref={containerRef} className="event-switcher-shell">
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
        <div id={menuId} className="event-switcher-menu">
          {orderedEvents === null && !loadError && <div className="event-switcher-status">Loading…</div>}
          {orderedEvents === null && loadError && (
            <div role="alert" className="event-switcher-status">
              <span>{loadError}</span>
              <button type="button" className="text-button" onClick={() => {
                setLoadError("");
                setLoadAttempt((attempt) => attempt + 1);
              }}>Retry</button>
            </div>
          )}
          {orderedEvents?.length === 0 && <div className="event-switcher-status">No events yet</div>}
          {orderedEvents?.map((event) => (
            <Link
              key={event.id}
              className={`event-switcher-option is-${eventLifecycle(event, lifecycleNowIso)}`}
              href={eventManagementHref(event.id as EventId, event.role ?? "organizer") ?? "/events"}
              aria-current={event.id === eventId ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              <span className="event-switcher-initials">{initials(event.name)}</span>
              <span>
                <b>
                  {event.name}
                  {rowIsDemo(event) && <StatusBadge value="demo" />}
                </b>
                <small>
                  {formatDateRangeInZone(event.startsAt, event.endsAt, event.timezone)}
                </small>
              </span>
            </Link>
          ))}
          <Link
            className="event-switcher-menu-footer"
            href={demoEvents || !canCreateEvent ? "/events" : "/organizations?intent=create-event"}
            onClick={() => setOpen(false)}
          >
            {demoEvents || !canCreateEvent ? "All events" : "+ Create event"}
          </Link>
        </div>
      )}
    </div>
  );
}
