"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "organization";
}

/**
 * M47 — the one entry point into `GET /…/organizations/[organizationId]/export`.
 * The endpoint (and `exportOrganizationData` behind it) was verified correct
 * but had nothing calling it; this button is that caller. It fetches the
 * bundle and hands it to the browser as a downloaded JSON file — a plain
 * client download, the same `Blob` + object-URL idiom `crm-import-dialog.tsx`
 * uses for its error report, rather than a new server surface.
 *
 * Owner-gated by its caller (organization home renders it only for owners),
 * one step above the organizer bar the endpoint itself enforces: the bundle
 * gathers the member list, pending invitations and the full audit trail into
 * one file, so the person who can carry all of it out at once is the
 * organization's owner.
 */
export function ExportOrganizationButton({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/internal/organizations/${organizationId}/export`);
      // A non-JSON body (a proxy's HTML 502, an empty response) must not surface
      // a raw SyntaxError — fall back to the same friendly message every failure
      // path uses.
      const json = await response.json().catch(() => null) as { data?: unknown; error?: { message?: string } } | null;
      if (!response.ok || json?.data === undefined) throw new Error(json?.error?.message ?? "Could not export the organization’s data");
      const blob = new Blob([JSON.stringify(json.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slugify(organizationName)}-export.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast("Organization data exported");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not export the organization’s data", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" onClick={() => void run()} disabled={busy}>
      <Download size={16} /> {busy ? "Exporting…" : "Export data"}
    </Button>
  );
}
