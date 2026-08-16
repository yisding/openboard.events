"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { RefreshCcw, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { Button, Field } from "@/shared/ui/ui-kit";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { useToast } from "@/shared/ui/toast";
// The engine's mirror module, not its barrel: dropping a localStorage key
// costs fifteen lines, and importing `@/shared/ui/app/guided-tour` would pull
// the whole tour engine into the dashboard's first load for it.
import { forgetTourMirror } from "@/shared/ui/app/guided-tour/mirror";
import { api } from "@/shared/lib/api-client";
import type { EventId, OrganizationId } from "@/shared/contracts";
// The feature's own zod modules, never its barrel: `@/features/onboarding`
// re-exports the server readers, and pulling those into a `"use client"`
// module would drag `src/db/client` into the browser bundle behind them.
import { demoDeleteRequestSchema, demoDeleteResultSchema, demoProvisionStateSchema } from "../demo-schemas";
import { tourCursorPatchSchema, tourStateSchema } from "../tour-schemas";

/**
 * First Fair (design §5.1, §5.3) — the demo dashboard's ribbon: the one place
 * that names what the player is looking at and hands them every way out. Jade
 * because a demo is not a warning; it is a fact about the event, the same
 * posture `STATUS_BADGES.demo` takes.
 *
 * Free play means every one of these actions operates on an ordinary event —
 * this component never assumes it is the only writer touching the demo, it
 * only offers the four moves specific to *being* one.
 */
export function DemoRibbon({
  eventId,
  eventName,
  organizationId,
}: {
  eventId: EventId;
  eventName: string;
  organizationId: OrganizationId;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [restarting, setRestarting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState("");
  const [deleting, setDeleting] = useState(false);

  /**
   * Rewinding the cursor is only half of a restart.
   *
   * The engine seeds itself from the layout's bootstrap *once*, and it trusts
   * a localStorage mirror of the last step this browser reached whenever that
   * mirror is ahead of the server. So a restart that only PATCHes and calls
   * `router.refresh()` changes nothing the player can see: the layer never
   * re-seeds, and the next hard load adopts the mirror and jumps straight back
   * to where they were. On a finished tour that is the curtain call — a modal
   * `<dialog>` that owns the top layer and leaves this very ribbon unclickable.
   *
   * Hence both halves, and a real document load rather than a soft refresh,
   * for the reason the command palette's tour entries already document.
   */
  async function restartTour() {
    if (restarting) return;
    setRestarting(true);
    try {
      const current = await api(`events/${eventId}/tour`, tourStateSchema);
      await api(`events/${eventId}/tour`, tourStateSchema, {
        method: "PATCH",
        body: tourCursorPatchSchema.parse({
          expectedStepId: current.stepId,
          chapter: "cold-open",
          stepId: "coldopen.hello",
          status: "active",
        }),
      });
      forgetTourMirror(eventId);
      // No success toast: the cold open reappearing says it better, and a
      // toast raised immediately before a document load is a flash of text
      // nobody can read.
      window.location.assign(`/events/${eventId}/dashboard`);
    } catch {
      // `kind: "error"` because it is one: a success toast disappears after
      // three seconds and carries a green check, which is the wrong shape for
      // "the button you just pressed did not do anything".
      toast("Could not restart the tour — try again from the command palette", { kind: "error" });
      setRestarting(false);
    }
  }

  /**
   * `mode: "reset"` deletes and re-provisions phase one in a single request;
   * every request after that drives the remaining phases the same way the
   * provisioning screen does, so the ribbon never leaves the world half
   * rebuilt if the organizer navigates away mid-reset — the next "Reset"
   * (or the demo dashboard's own resume pill) just picks the cursor back up.
   */
  async function resetDemo() {
    if (resetting) return;
    setResetting(true);
    try {
      let state = await api(`organizations/${organizationId}/demo`, demoProvisionStateSchema, {
        method: "POST",
        body: { mode: "reset" },
      });
      let guard = 0;
      while (!state.done && guard < 12) {
        state = await api(`organizations/${organizationId}/demo`, demoProvisionStateSchema, {
          method: "POST",
          body: { mode: "provision" },
        });
        guard += 1;
      }
      setConfirmingReset(false);
      // A reset drops the event row and rebuilds it under the same
      // deterministic id, so the tutorial cursor it carried is gone too — but
      // the engine's localStorage mirror of it is not, and a mirror that
      // outlives its world sends a brand-new tour straight to the last step of
      // the old one. Same reason as `restartTour` for the document load: the
      // tour layer seeds from the layout's bootstrap once per load.
      forgetTourMirror(eventId);
      window.location.assign(`/events/${eventId}/dashboard`);
    } catch {
      toast("Reset did not finish — press Reset again to pick up where it stopped", { kind: "error" });
      setResetting(false);
    }
  }

  async function deleteDemo() {
    if (deleting) return;
    setDeleting(true);
    try {
      await api(`organizations/${organizationId}/demo`, demoDeleteResultSchema, {
        method: "DELETE",
        body: demoDeleteRequestSchema.parse({ confirm: "DELETE" }),
      });
      setConfirmingDelete(false);
      // The next demo this organization builds gets the *same* event id
      // (`demoEventId` is derived from the organization), so a mirror left
      // behind here would be adopted by that new tour and fast-forward it to
      // the step this deleted one ended on.
      forgetTourMirror(eventId);
      toast(`${eventName} deleted`);
      router.push(`/organizations/${organizationId}`);
      router.refresh();
    } catch {
      toast("Could not delete the demo — try again", { kind: "error" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      role="note"
      style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12,
        padding: "12px 16px", borderRadius: 10, background: "var(--fill)", border: "1px solid var(--accent)",
      }}
    >
      <p style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: "var(--text-sm, 14px)" }}>
        <Sparkles size={16} aria-hidden="true" /> This is your demo event. Change anything. Nothing here can email a real person.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Button size="sm" variant="secondary" onClick={() => void restartTour()} disabled={restarting}>
          <RotateCcw size={14} aria-hidden="true" /> {restarting ? "Restarting…" : "Restart tour"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setConfirmingReset(true)}>
          <RefreshCcw size={14} aria-hidden="true" /> Reset
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setConfirmingDelete(true)}>
          <Trash2 size={14} aria-hidden="true" /> Delete
        </Button>
        <Link href={`/organizations/${organizationId}/onboarding?mode=create&from=demo`} className="button button-primary">
          Create my real event
        </Link>
      </div>

      <ConfirmDialog
        open={confirmingReset}
        title="Rebuild this demo?"
        body="Everything in it — every proposal, every review, every session — is replaced with a fresh copy. Anything you customized is gone."
        confirmLabel={resetting ? "Rebuilding…" : "Reset demo"}
        confirmDisabled={resetting}
        onConfirm={resetDemo}
        onCancel={() => setConfirmingReset(false)}
      />

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this demo event?"
        variant="destructive"
        confirmLabel={deleting ? "Deleting…" : "Delete demo event"}
        confirmDisabled={deleting || deleteTyped.trim() !== eventName}
        onConfirm={deleteDemo}
        onCancel={() => { setConfirmingDelete(false); setDeleteTyped(""); }}
        body={
          <div className="form-stack">
            <p>This removes the demo and everything in it for good — the resume pill, the quest log, anything you changed. This cannot be undone.</p>
            <Field label={`Type "${eventName}" to confirm`}>
              <input value={deleteTyped} onChange={(changeEvent) => setDeleteTyped(changeEvent.target.value)} autoComplete="off" />
            </Field>
          </div>
        }
      />
    </div>
  );
}
