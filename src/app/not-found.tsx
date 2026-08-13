import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/shared/ui/brand";
import { LostCompass } from "@/shared/ui/lost-compass";

export default function NotFound() {
  return <main className="not-found"><Brand dark /><LostCompass /><span>404</span><h1>This board is off the agenda.</h1><p>The page may have moved, or the link is no longer active.</p><Link href="/" className="button button-primary"><ArrowLeft size={16} /> Back to Openboard</Link></main>;
}
