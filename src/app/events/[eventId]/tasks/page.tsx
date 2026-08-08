import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";
import { StubPage } from "@/features/shell/stub-page";

export const metadata: Metadata = { title: "Tasks" };
export default function Page() {
  return <StubPage icon={ClipboardCheck} title="Tasks" description="Assign onboarding tasks and track speaker completion." milestone="M23" />;
}
