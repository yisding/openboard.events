import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { Brand } from "@/shared/ui/brand";

export const metadata: Metadata = { title: "Call for proposals" };
export default function Page() {
  return <main className="not-found"><Brand dark /><div className="empty-icon"><FileText size={24} /></div><span>COMING SOON</span><h1>The CFP wizard is on its way.</h1><p>This page ships with milestone M15. The route is reserved so links from the landing page never dead-end.</p><Link href="/" className="button button-primary"><ArrowLeft size={16} /> Back home</Link></main>;
}
