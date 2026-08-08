import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { Brand } from "@/shared/ui/brand";

export const metadata: Metadata = { title: "Public schedule" };
export default function Page() {
  return <main className="not-found"><Brand dark /><div className="empty-icon"><CalendarDays size={24} /></div><span>COMING SOON</span><h1>The public schedule is on its way.</h1><p>This page ships with milestone M32. The route is reserved so links from the admin shell never dead-end.</p><Link href="/events" className="button button-primary"><ArrowLeft size={16} /> Back to events</Link></main>;
}
