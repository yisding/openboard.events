import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";
import { StubPage } from "@/features/shell/stub-page";

export const metadata: Metadata = { title: "Abstracts" };
export default function Page() {
  return <StubPage icon={ClipboardCheck} title="Abstracts" description="Triage submissions, filter by track, and move them through decisions." milestone="M17" />;
}
