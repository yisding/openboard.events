import Image from "next/image";
import { CalendarDays, MapPin, Sparkles } from "lucide-react";
import type { SpeakerShareDTO } from "@/features/portal/index.share";
import { formatInZone } from "@/shared/lib/time";

/**
 * M59 — the page an accepted speaker actually wants to post. Generous, not
 * dense (public-facing, per experience-design.md's "two densities"
 * principle): one big headshot, one big claim, event branding underneath.
 */
export function SpeakerSharePage({ data }: { data: SpeakerShareDTO }) {
  const { speakerName, submissionTitle, eventName, headshotUrl, schedule, eventTimezone } = data;
  return (
    <main className="share-page">
      <div className="share-card">
        <span className="share-eyebrow"><Sparkles size={14} /> I&rsquo;m speaking at {eventName}</span>
        {headshotUrl
          // Our own immutable-cached `/f/[fileId]` route, not a remote host —
          // same `unoptimized` convention as `SpeakerHeadshot`/the profile photo.
          ? <Image className="share-headshot" src={headshotUrl} alt={speakerName} width={128} height={128} unoptimized />
          : <span className="share-headshot share-headshot-fallback" aria-hidden="true">{speakerName.slice(0, 2).toUpperCase()}</span>}
        <h1>{speakerName}</h1>
        <p className="share-talk-title">&ldquo;{submissionTitle}&rdquo;</p>
        {schedule && (
          <div className="share-schedule">
            <span><CalendarDays size={15} /> {formatInZone(schedule.startsAt, eventTimezone, "long")}</span>
            {schedule.roomName && <span><MapPin size={15} /> {schedule.roomName}</span>}
          </div>
        )}
        <footer>{eventName}</footer>
      </div>
    </main>
  );
}
