"use client";

import type { AgendaViewProps } from "../index.client";
import { GroupedAgendaList } from "./grouped-agenda-list";

/** ./M31-agenda-views.md's Track view — one lane per track, via `<GroupedAgendaList>`. */
export default function TrackView({ sessions, tracks, rooms, event }: AgendaViewProps) {
  return <GroupedAgendaList groupBy="track" sessions={sessions} tracks={tracks} rooms={rooms} tz={event.timezone} />;
}
