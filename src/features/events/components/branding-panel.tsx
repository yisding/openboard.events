"use client";

import Image from "next/image";
import { useState } from "react";
import { FileUpload } from "@/shared/ui/app/file-upload";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { eventDtoSchema, type EventDTO } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

/**
 * Logo/background save immediately on upload rather than waiting for the
 * Details tab's "Save changes" — an upload is already a multi-step async
 * action, and making it also depend on a second, separate click is the kind
 * of "did that actually save?" moment this avoids. Each save bumps
 * `rowVersion`, and `onSaved` hands the fresh event back up so the Details
 * form's next save uses the current version instead of a stale one.
 */
export function BrandingPanel({ event, onSaved }: { event: EventDTO; onSaved: (event: EventDTO) => void }) {
  const { toast } = useToast();
  const [busyField, setBusyField] = useState<"logoFileId" | "backgroundFileId" | null>(null);

  async function persist(field: "logoFileId" | "backgroundFileId", fileId: string) {
    setBusyField(field);
    try {
      const updated = await api(`events/${event.id}`, eventDtoSchema, {
        method: "PATCH",
        body: { expectedRowVersion: event.rowVersion, patch: { [field]: fileId } },
      });
      onSaved(updated);
      toast(field === "logoFileId" ? "Logo updated" : "Background image updated");
      return true;
    } catch (caught) {
      toast(isAppError(caught) && caught.code === "STALE_WRITE"
        ? "This event changed since you loaded it — refresh to see the latest"
        : "That image did not save", { kind: "error" });
      return false;
    } finally {
      setBusyField(null);
    }
  }

  return (
    <div className="settings-section">
      <header>
        <h2>Image settings</h2>
        <p>Shown on the public CFP, portal, gallery and schedule.</p>
      </header>
      <div className="form-grid">
        <div className="form-stack">
          <span>Logo image</span>
          <small className="hint">Recommended: 300 × 300</small>
          {/* `logo`/`background` are the two public file kinds (`KIND_POLICY`
              in `shared/server/r2.ts`), served straight from `/f/[fileId]` —
              no authorized-download round trip like a private attachment. */}
          {event.logoFileId && (
            <Image src={`/f/${event.logoFileId}`} alt="Event logo" width={200} height={64} unoptimized style={{ height: 64, width: "auto", objectFit: "contain" }} />
          )}
          <FileUpload
            eventId={event.id}
            kind="logo"
            currentFileId={event.logoFileId}
            onUploaded={(fileId) => persist("logoFileId", fileId)}
            label={busyField === "logoFileId" ? "Saving…" : event.logoFileId ? "Replace logo" : "Upload logo"}
          />
        </div>
        <div className="form-stack">
          <span>Background image</span>
          <small className="hint">Recommended: 1500 × 500</small>
          {event.backgroundFileId && (
            <Image src={`/f/${event.backgroundFileId}`} alt="Event background" width={200} height={64} unoptimized style={{ height: 64, width: 200, objectFit: "cover" }} />
          )}
          <FileUpload
            eventId={event.id}
            kind="background"
            currentFileId={event.backgroundFileId}
            onUploaded={(fileId) => persist("backgroundFileId", fileId)}
            label={busyField === "backgroundFileId" ? "Saving…" : event.backgroundFileId ? "Replace background" : "Upload background"}
          />
        </div>
      </div>
    </div>
  );
}
