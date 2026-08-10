"use client";

import type { AgendaViewProps } from "../index.client";
import { GroupedAgendaList } from "./grouped-agenda-list";

/** ./M31-agenda-views.md's Room view — one lane per room, via `<GroupedAgendaList>`. */
export default function RoomView({ sessions, tracks, rooms, event }: AgendaViewProps) {
  return <GroupedAgendaList groupBy="room" sessions={sessions} tracks={tracks} rooms={rooms} tz={event.timezone} />;
}
