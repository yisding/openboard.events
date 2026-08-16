"use client";

import { CalendarDays, ChevronRight, KeyRound, MapPin, Settings2, Table2, Tag } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/shared/ui/ui-kit";
import { useGuardedAction } from "@/shared/ui/app/unsaved-work-guard";
import type { EventDTO, RoomDTO, SessionFormatDTO, TagDTO, TrackDTO } from "@/shared/contracts";
import { DetailsTab } from "./details-tab";
import { EventAccessTab } from "./event-access-tab";
import { VocabTab } from "./vocab-tab";

export type Vocabulary = { tracks: TrackDTO[]; rooms: RoomDTO[]; formats: SessionFormatDTO[]; tags: TagDTO[] };

/**
 * Both of these surfaces own a whole route (`settings/api-keys`,
 * `settings/airtable`) because each carries a credential, a history table and
 * its own data fetch — too much for a tab in this shell. But a route nothing
 * links to is a route nobody finds: neither appears in the sidebar's
 * `NAVIGATION` groups, so Access is where an organizer looking for "the thing
 * that lets something else read this event" arrives, and this is the signpost
 * that gets them the rest of the way.
 */
const INTEGRATION_LINKS = [
  {
    href: "api-keys",
    icon: KeyRound,
    title: "API keys",
    description: "Bearer keys for /api/v1's keyed endpoints, scoped to this event.",
  },
  {
    href: "airtable",
    icon: Table2,
    title: "Airtable sync",
    description: "Keep an Airtable base in step with your sessions, speakers, and proposals.",
  },
] as const;

function IntegrationLinks({ eventId }: { eventId: string }) {
  return (
    <section className="panel settings-section">
      <header>
        <h2>Connected tools</h2>
        <p>Each of these lives on its own page — credentials, history, and a manual trigger don&apos;t fit in a tab.</p>
      </header>
      <div className="settings-link-cards">
        {INTEGRATION_LINKS.map((link) => (
          <Link key={link.href} href={`/events/${eventId}/settings/${link.href}`} className="settings-link-card">
            <span className="metric-icon accent"><link.icon size={16} /></span>
            <span>
              <b>{link.title}</b>
              <small>{link.description}</small>
            </span>
            <ChevronRight size={16} aria-hidden />
          </Link>
        ))}
      </div>
    </section>
  );
}

const TABS = [
  ["details", "Event details", Settings2],
  ["tracks", "Tracks", Tag],
  ["rooms", "Rooms", MapPin],
  ["formats", "Formats", CalendarDays],
  ["tags", "Tags", Tag],
  ["access", "Access", KeyRound],
] as const;
type Tab = (typeof TABS)[number][0];

/**
 * Tabs synced to `?tab=` (shallow, no full navigation) so a saved link or a
 * refresh lands the organizer back on the tab they were editing.
 */
export function SettingsShell({ event, vocabulary }: { event: EventDTO; vocabulary: Vocabulary }) {
  const router = useRouter();
  const { runGuarded, allowNextNavigation } = useGuardedAction();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const tab: Tab = (TABS.some(([id]) => id === requested) ? requested : "details") as Tab;

  // The Details tab keeps its own `event` copy so a save can update the
  // rowVersion/name/theme in place without a full RSC round trip.
  const [current, setCurrent] = useState(event);
  useEffect(() => setCurrent((saved) => event.rowVersion > saved.rowVersion ? event : saved), [event]);

  function setTab(next: Tab) {
    if (next === tab) return;
    const href = `/events/${event.id}/settings?tab=${next}`;
    runGuarded(() => allowNextNavigation(() => {
      router.push(href, { scroll: false });
    }, { destination: href }));
  }

  return (
    <>
      <PageHeader eyebrow="EVENT" title="Event settings" description="Details, vocabulary, and public event configuration." />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Event settings sections">
          {TABS.map(([id, label, Icon]) => (
            <button key={id} type="button" aria-pressed={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              <Icon size={16} /> <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-main">
          {tab === "details" && <DetailsTab event={current} onSaved={setCurrent} />}
          {tab === "tracks" && <VocabTab eventId={event.id} kind="tracks" initialItems={vocabulary.tracks} />}
          {tab === "rooms" && <VocabTab eventId={event.id} kind="rooms" initialItems={vocabulary.rooms} />}
          {tab === "formats" && <VocabTab eventId={event.id} kind="formats" initialItems={vocabulary.formats} />}
          {tab === "tags" && <VocabTab eventId={event.id} kind="tags" initialItems={vocabulary.tags} />}
          {tab === "access" && <EventAccessTab eventId={event.id} />}
          {tab === "access" && <IntegrationLinks eventId={event.id} />}
        </div>
      </div>
    </>
  );
}
