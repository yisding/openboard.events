import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { StubPage } from "@/features/shell/stub-page";

export const metadata: Metadata = { title: "Event settings" };
export default function Page() {
  return <StubPage icon={Settings} title="Event settings" description="Configure event branding, dates, and access." milestone="M11" />;
}
