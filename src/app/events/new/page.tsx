import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/shared/ui/brand";
import { EventForm } from "@/features/events/components/event-form";

export const metadata: Metadata = { title: "Create event" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <main className="events-index">
      <header className="events-index-header">
        <Brand dark />
        <Link href="/events" className="header-help" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ArrowLeft size={14} /> Back to events
        </Link>
      </header>
      <section className="events-index-content" style={{ maxWidth: 640, width: "min(640px, calc(100% - 48px))" }}>
        <div className="events-title">
          <div>
            <div className="page-eyebrow">Workspace</div>
            <h1>Create event</h1>
            <p>Name it, place it in time, and its Tracks/Rooms/Formats/Tags settings will be ready to fill in next.</p>
          </div>
        </div>
        <div className="panel settings-section">
          <EventForm />
        </div>
      </section>
    </main>
  );
}
