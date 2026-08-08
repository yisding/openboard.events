import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { StubPage } from "@/features/shell/stub-page";

export const metadata: Metadata = { title: "Forms" };
export default function Page() {
  return <StubPage icon={FileText} title="Forms" description="Build and version the CFP and portal forms speakers fill in." milestone="M12" />;
}
