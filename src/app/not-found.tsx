import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";
import { Brand } from "@/shared/ui/brand";

export default function NotFound() {
  return <main className="not-found"><Brand dark /><div className="empty-icon"><Compass size={24} /></div><span>404</span><h1>This board is off the agenda.</h1><p>The page may have moved, or the link is no longer active.</p><Link href="/events" className="button button-primary"><ArrowLeft size={16} /> Back to events</Link></main>;
}
