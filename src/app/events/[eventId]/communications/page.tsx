import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { StubPage } from "@/features/shell/stub-page";

export const metadata: Metadata = { title: "Communications" };
export default function Page() {
  return <StubPage icon={Mail} title="Communications" description="Send decision, reminder, and update emails to your speakers." milestone="M37" />;
}
