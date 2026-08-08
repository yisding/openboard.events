import type { Metadata } from "next";
import { PanelTop } from "lucide-react";
import { StubPage } from "@/features/shell/stub-page";

export const metadata: Metadata = { title: "Embeds" };
export default function Page() {
  return <StubPage icon={PanelTop} title="Embeds" description="Embed the schedule and speaker gallery on your own site." milestone="M33" />;
}
