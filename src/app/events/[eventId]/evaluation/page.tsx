import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { StubPage } from "@/features/shell/stub-page";

export const metadata: Metadata = { title: "Evaluation" };
export default function Page() {
  return <StubPage icon={BarChart3} title="Evaluation" description="Score submissions and compare reviewer ratings side by side." milestone="M19" />;
}
