import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { StubPage } from "@/features/shell/stub-page";

export const metadata: Metadata = { title: "Resources" };
export default function Page() {
  return <StubPage icon={BookOpen} title="Resources" description="Publish handbooks and guidelines to the speaker portal." milestone="M26" />;
}
