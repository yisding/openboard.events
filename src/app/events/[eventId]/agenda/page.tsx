import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { StubPage } from "@/features/shell/stub-page";

export const metadata: Metadata = { title: "Agenda" };
export default function Page() {
  return <StubPage icon={CalendarDays} title="Agenda" description="Plan rooms and time slots, then publish the schedule." milestone="M31" />;
}
