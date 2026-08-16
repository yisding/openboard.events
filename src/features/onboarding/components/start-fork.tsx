"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CalendarPlus, Sparkles } from "lucide-react";
import type { OrganizationId } from "@/shared/contracts";
import { Button } from "@/shared/ui/ui-kit";
import type { DemoProvisionStateDTO } from "../demo-schemas";
import { DemoProvisioningScreen } from "./demo-provisioning-screen";

/**
 * First Fair (design §1.1) — the title screen.
 *
 * It renders in place of the setup wizard, in the wizard's own route, for the
 * one audience that has a real choice to make: an organizer whose organization
 * has no programme in it yet and no half-finished setup. Everyone else —
 * anybody who pressed a button that said *Create event*, anybody with an open
 * checkpoint, anybody who already runs events here — never sees it.
 *
 * Two doors of equal visual weight and one escape hatch. The demo door is
 * primary because it is the better first ten minutes for almost everybody, but
 * "Set up my real event" is right beside it in the same size type, and *"Skip
 * both"* is always there. Nobody is funnelled and nobody is stranded: the fork
 * stays reachable from the organization home for as long as there is no demo.
 */

export type StartForkVariant = "first-run" | "demo-exists";

export function startForkVariant(demo: DemoProvisionStateDTO | null): StartForkVariant {
  return demo ? "demo-exists" : "first-run";
}

export function StartFork({ organizationId, demo = null }: {
  organizationId: OrganizationId;
  /** The demo's provisioning cursor, or `null` if this organization has never built one. */
  demo?: DemoProvisionStateDTO | null;
}) {
  const variant = startForkVariant(demo);
  // A demo that exists but never finished being built is not a third door —
  // it is the same door, resumed. The provisioner picks up at its cursor.
  const [building, setBuilding] = useState(false);
  const started = building || (demo !== null && !demo.done);

  if (started) {
    return <DemoProvisioningScreen organizationId={organizationId} initialState={demo} />;
  }

  return (
    <div className="onboarding-wizard">
      <div className="event-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <section className="panel" style={{ display: "grid", alignContent: "start", gap: 10, padding: 20, borderColor: "var(--accent-border)" }}>
          <span className="metric-icon accent" aria-hidden="true"><Sparkles size={20} /></span>
          <h2 style={{ margin: 0, fontSize: "var(--text-base)" }}>
            {variant === "demo-exists" ? "Back to your demo conference" : "Explore a finished conference"}
          </h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "var(--text-sm)", lineHeight: 1.55 }}>
            {variant === "demo-exists"
              ? "AI Engineer World's Fair is still waiting for you — every speaker, every proposal, and the two scheduling conflicts nobody has fixed yet. Pick the tour back up, or just poke around."
              : "We'll build you AI Engineer World's Fair — 18 speakers, 24 proposals, and an agenda with two scheduling conflicts we planted on purpose. None of it is real, all of it works, and nothing in there can email anybody. Ten minutes?"}
          </p>
          {variant === "demo-exists" && demo
            ? <Link className="button button-primary" href={`/events/${demo.eventId}/dashboard`} style={{ justifySelf: "start" }}>
              Open the demo <ArrowRight size={16} />
            </Link>
            : <Button onClick={() => setBuilding(true)} style={{ justifySelf: "start" }}>
              Build it for me <ArrowRight size={16} />
            </Button>}
        </section>

        <section className="panel" style={{ display: "grid", alignContent: "start", gap: 10, padding: 20 }}>
          <span className="metric-icon" aria-hidden="true"><CalendarPlus size={20} /></span>
          <h2 style={{ margin: 0, fontSize: "var(--text-base)" }}>Set up my real event</h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "var(--text-sm)", lineHeight: 1.55 }}>
            You know your conference. Name, dates, a track or two, and a public call for speakers.
          </p>
          {/* `?mode=create` is the same flag every other create entrance
              carries, so the wizard renders in this route and a reload,
              a bookmark or a shared link all land on it again. */}
          <Link className="button button-secondary" href={`/organizations/${organizationId}/onboarding?mode=create`} style={{ justifySelf: "start" }}>
            Start setting it up <ArrowRight size={16} />
          </Link>
        </section>
      </div>

      {/* A query parameter rather than a cookie: App Router cannot write one
          during a page render, and one request without the redirect is all
          "not right now" needs to mean. */}
      <p style={{ margin: "16px 0 0", fontSize: "var(--text-sm)" }}>
        <Link href={`/organizations/${organizationId}?skip=1`}>Skip both — take me to my organization &rarr;</Link>
      </p>
    </div>
  );
}
