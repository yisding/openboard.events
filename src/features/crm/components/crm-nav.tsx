import Link from "next/link";
import { Contact, Kanban, Layers } from "lucide-react";
import type { OrganizationId } from "@/shared/contracts";

/**
 * M55 — the three CRM surfaces share this subnav (Directory / Pipeline /
 * Segments) the same way M44's Team/Audit pages are reachable from the
 * organization home rather than each inventing its own way back. A server
 * component (no `"use client"`) — the active tab is passed in by the page
 * that already knows which one it is, so this never needs its own state.
 */
export function CrmNav({ organizationId, active }: { organizationId: OrganizationId; active: "directory" | "contact" | "pipeline" | "segments" }) {
  return (
    <nav className="crm-subnav" aria-label="Speaker CRM">
      <Link href={`/organizations/${organizationId}/crm`} className={active === "directory" || active === "contact" ? "active" : ""}>
        <Contact size={14} /> Directory
      </Link>
      <Link href={`/organizations/${organizationId}/crm/pipeline`} className={active === "pipeline" ? "active" : ""}>
        <Kanban size={14} /> Pipeline
      </Link>
      <Link href={`/organizations/${organizationId}/crm/segments`} className={active === "segments" ? "active" : ""}>
        <Layers size={14} /> Segments
      </Link>
    </nav>
  );
}
