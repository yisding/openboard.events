"use client";

import { KeyRound, UserMinus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { eventAccessMemberDtoSchema, type EventAccessMemberDTO, type EventId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { Button, EmptyState, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

const removedSchema = z.object({ removed: z.boolean() });

/** The canonical recovery surface for every current event_members row. */
export function EventAccessTab({ eventId }: { eventId: EventId }) {
  const { toast } = useToast();
  const [members, setMembers] = useState<EventAccessMemberDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingRemove, setPendingRemove] = useState<EventAccessMemberDTO | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setMembers(await api(`events/${eventId}/access`, z.array(eventAccessMemberDtoSchema)));
    } catch (caught) {
      setError(isAppError(caught) ? caught.message : "Event access could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function removeAccess() {
    if (!pendingRemove || busy) return;
    const removed = pendingRemove;
    setBusy(true);
    try {
      await api(`events/${eventId}/access/${removed.userId}`, removedSchema, { method: "DELETE" });
      setMembers((current) => current.filter((member) => member.userId !== removed.userId));
      setPendingRemove(null);
      toast(`${removed.email} no longer has access to this event`);
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "That event access removal failed", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  return <>
    <section className="panel settings-section">
      <header>
        <h2><KeyRound size={16} /> Event access</h2>
        <p>Everyone who can open this event, including former organization teammates. Grant new access from Organization → Team.</p>
      </header>
      <div style={{ padding: "0 24px 24px" }}>
        {loading && <p className="loading-note" role="status">Loading event access…</p>}
        {error && <div className="form-stack"><p className="field-error" role="alert">{error}</p><Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button></div>}
        {!loading && !error && members.length === 0 && (
          <EmptyState icon={<KeyRound size={20} />} title="No event members" description="Every event should have an owner. Reload before making another access change." />
        )}
        {!loading && !error && members.length > 0 && <div className="team-event-access-list event-access-roster">
          {members.map((member) => <article key={member.userId}>
            <div><b>{member.name || member.email}</b><small>{member.email}</small></div>
            <StatusBadge value={member.role} />
            <small>{member.organizationMember ? "Current organization teammate" : "No longer in this organization"}</small>
            {member.canRemove
              ? <Button size="sm" variant="danger" disabled={busy} onClick={() => setPendingRemove(member)}><UserMinus size={14} /> Remove access</Button>
              : <small>{member.role === "owner" ? "Transfer ownership before removing" : "Ask another organizer to remove you"}</small>}
          </article>)}
        </div>}
      </div>
    </section>
    <ConfirmDialog
      open={pendingRemove !== null}
      title={`Remove ${pendingRemove?.email ?? "this person"} from the event?`}
      body={pendingRemove?.organizationMember
        ? "They will lose access to this event. Their organization membership is unchanged."
        : "This former teammate will lose their remaining access to this event."}
      confirmLabel="Remove event access"
      onConfirm={removeAccess}
      onCancel={() => setPendingRemove(null)}
    />
  </>;
}
