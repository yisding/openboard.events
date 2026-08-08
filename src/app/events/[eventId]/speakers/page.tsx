import type { Metadata } from "next";
import { Users } from "lucide-react";
import { StubPage } from "@/features/shell/stub-page";

export const metadata: Metadata = { title: "Speakers" };
export default function Page() {
  return <StubPage icon={Users} title="Speakers" description="Manage speaker profiles, confirmations, and onboarding progress." milestone="M27" />;
}
