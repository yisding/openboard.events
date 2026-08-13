"use client";

import { Check, KeyRound, Search, UserMinus, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  eventAccessMemberDtoSchema,
  eventAccessOverviewDtoSchema,
  type EventAccessGrantCandidateDTO,
  type EventAccessMemberDTO,
  type EventAccessOverviewDTO,
  type EventId,
} from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { Button, EmptyState, Field, Modal, Select, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

const removedSchema = z.object({ removed: z.boolean() });
type GrantRole = "organizer" | "reviewer";

const roleOrder = { owner: 0, organizer: 1, reviewer: 2 } as const;

function orderMembers(members: EventAccessMemberDTO[]): EventAccessMemberDTO[] {
  return [...members].sort((left, right) =>
    roleOrder[left.role] - roleOrder[right.role] || left.email.localeCompare(right.email));
}

/** The canonical recovery surface for every current event_members row. */
export function EventAccessTab({ eventId }: { eventId: EventId }) {
  const { toast } = useToast();
  const [members, setMembers] = useState<EventAccessMemberDTO[]>([]);
  const [candidates, setCandidates] = useState<EventAccessGrantCandidateDTO[]>([]);
  const [canGrant, setCanGrant] = useState(false);
  const [grantRestriction, setGrantRestriction] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingRemove, setPendingRemove] = useState<EventAccessMemberDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantSearch, setGrantSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [grantRole, setGrantRole] = useState<GrantRole>("reviewer");
  const [grantError, setGrantError] = useState("");
  const grantSearchRef = useRef<HTMLInputElement>(null);

  const applyOverview = useCallback((overview: EventAccessOverviewDTO) => {
    setMembers(overview.members);
    setCandidates(overview.candidates);
    setCanGrant(overview.canGrant);
    setGrantRestriction(overview.grantRestriction);
  }, []);

  const requestOverview = useCallback(() =>
    api(`events/${eventId}/access`, eventAccessOverviewDtoSchema), [eventId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      applyOverview(await requestOverview());
    } catch (caught) {
      setError(isAppError(caught) ? caught.message : "Event access could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [applyOverview, requestOverview]);

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
      void requestOverview().then(applyOverview).catch(() => undefined);
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "That event access removal failed", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  function openGrant() {
    setGrantSearch("");
    setSelectedUserId(null);
    setGrantRole("reviewer");
    setGrantError("");
    setGrantOpen(true);
  }

  function closeGrant() {
    if (busy) return;
    setGrantOpen(false);
    setGrantError("");
  }

  async function grantAccess() {
    if (!selectedUserId || busy) return;
    const candidate = candidates.find((person) => person.userId === selectedUserId);
    if (!candidate) {
      setGrantError("That teammate is no longer available. Choose another teammate.");
      return;
    }
    setBusy(true);
    setGrantError("");
    try {
      const granted = await api(
        `events/${eventId}/access/${candidate.userId}`,
        eventAccessMemberDtoSchema,
        { method: "PATCH", body: { role: grantRole } },
      );
      setMembers((current) => orderMembers([
        ...current.filter((member) => member.userId !== granted.userId),
        granted,
      ]));
      setCandidates((current) => current.filter((person) => person.userId !== granted.userId));
      setGrantOpen(false);
      toast(granted.role === grantRole
        ? `${candidate.name || candidate.email} can now open this event as ${granted.role}`
        : `${candidate.name || candidate.email} already has stronger ${granted.role} access`);
    } catch (caught) {
      const stale = isAppError(caught) && (caught.code === "FORBIDDEN" || caught.code === "NOT_FOUND");
      if (!stale) {
        setGrantError(isAppError(caught) ? caught.message : "Event access could not be granted");
        return;
      }
      try {
        const refreshed = await requestOverview();
        applyOverview(refreshed);
        if (!refreshed.canGrant) {
          setGrantOpen(false);
          toast(refreshed.grantRestriction ?? "Your event access permissions changed", { kind: "error" });
        } else {
          setSelectedUserId(null);
          setGrantError("That teammate's access changed while you were choosing. The list is refreshed.");
        }
      } catch {
        setGrantError("That teammate's access changed. Close this picker and reload Event access before trying again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const filteredCandidates = useMemo(() => {
    const query = grantSearch.trim().toLocaleLowerCase();
    if (!query) return candidates;
    return candidates.filter((candidate) =>
      `${candidate.name} ${candidate.email}`.toLocaleLowerCase().includes(query));
  }, [candidates, grantSearch]);
  const selectedCandidate = candidates.find((candidate) => candidate.userId === selectedUserId) ?? null;

  return <>
    <section className="panel settings-section">
      <header className="event-access-header">
        <div>
          <h2><KeyRound size={16} /> Event access</h2>
          <p>Everyone who can open this event, including former organization teammates.</p>
        </div>
        {!loading && !error && canGrant && <Button size="sm" onClick={openGrant}><UserPlus size={14} /> Grant access</Button>}
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
        {!loading && !error && grantRestriction && <p className="event-access-restriction"><KeyRound size={14} /> {grantRestriction}</p>}
      </div>
    </section>
    <Modal
      open={grantOpen && canGrant}
      onClose={closeGrant}
      title="Grant event access"
      description="Choose a current organization teammate. Event access is separate from their organization role."
      initialFocusRef={grantSearchRef}
      footer={<>
        <Button variant="secondary" disabled={busy} onClick={closeGrant}>Cancel</Button>
        <Button disabled={busy || !selectedCandidate} onClick={() => void grantAccess()}>
          {busy ? "Granting…" : "Grant access"}
        </Button>
      </>}
    >
      {candidates.length === 0
        ? <EmptyState
            icon={<UserPlus size={20} />}
            title="Everyone is already included"
            description="Every other current organization teammate already has access to this event. Add teammates from Organization → Team first."
          />
        : <div className="form-stack">
            <Field label="Find a teammate">
              <div className="event-access-search">
                <Search size={15} aria-hidden />
                <input
                  ref={grantSearchRef}
                  value={grantSearch}
                  onChange={(event) => setGrantSearch(event.target.value)}
                  placeholder="Search by name or email"
                />
              </div>
            </Field>
            <div className="event-access-candidates" role="group" aria-label="Available teammates">
              {filteredCandidates.map((candidate) => <button
                key={candidate.userId}
                type="button"
                aria-pressed={selectedUserId === candidate.userId}
                onClick={() => {
                  setSelectedUserId(candidate.userId);
                  setGrantError("");
                }}
              >
                <span><b>{candidate.name || candidate.email}</b><small>{candidate.email}</small></span>
                <small>{candidate.organizationRole} in organization</small>
                {selectedUserId === candidate.userId && <Check size={16} aria-hidden />}
              </button>)}
              {filteredCandidates.length === 0 && <p className="event-access-no-results">No teammates match “{grantSearch.trim()}”.</p>}
            </div>
            <Field label="Event role" required>
              <Select value={grantRole} onChange={(event) => setGrantRole(event.target.value as GrantRole)}>
                <option value="reviewer">Reviewer</option>
                <option value="organizer">Organizer</option>
              </Select>
              <small>Reviewers evaluate submissions. Organizers can manage the entire event.</small>
            </Field>
          </div>}
      {grantError && <p className="field-error" role="alert">{grantError}</p>}
    </Modal>
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
