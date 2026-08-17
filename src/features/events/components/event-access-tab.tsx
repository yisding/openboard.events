"use client";

import { AlertTriangle, Check, KeyRound, Search, UserMinus, UserPlus } from "lucide-react";
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
import { isAppError, isDefinitiveWriteFailure } from "@/shared/lib/errors";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { LoadFailure } from "@/shared/ui/app/load-failure";
import { SkeletonText } from "@/shared/ui/app/skeleton";
import { useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { Button, EmptyState, Field, Modal, Select, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

const removedSchema = z.object({ removed: z.boolean() });
type GrantRole = "organizer" | "reviewer";
type EventAccessRecovery =
  | { action: "grant"; candidate: EventAccessGrantCandidateDTO; requestedRole: GrantRole; replayRejected: boolean }
  | { action: "remove"; member: EventAccessMemberDTO; replayRejected: boolean };

const roleOrder = { owner: 0, organizer: 1, reviewer: 2 } as const;

function orderMembers(members: EventAccessMemberDTO[]): EventAccessMemberDTO[] {
  return [...members].sort((left, right) =>
    roleOrder[left.role] - roleOrder[right.role] || left.email.localeCompare(right.email));
}

function recoverySubject(recovery: EventAccessRecovery): string {
  return recovery.action === "grant" ? recovery.candidate.email : recovery.member.email;
}

function authoritativeAccess(
  overview: EventAccessOverviewDTO,
  recovery: EventAccessRecovery,
): EventAccessMemberDTO | undefined {
  const userId = recovery.action === "grant" ? recovery.candidate.userId : recovery.member.userId;
  return overview.members.find((member) => member.userId === userId);
}

function requestedStateIsCurrent(
  overview: EventAccessOverviewDTO,
  recovery: EventAccessRecovery,
): boolean {
  const current = authoritativeAccess(overview, recovery);
  if (recovery.action === "remove") return current === undefined;
  return current !== undefined && roleOrder[current.role] <= roleOrder[recovery.requestedRole];
}

function currentAccessDescription(
  overview: EventAccessOverviewDTO,
  recovery: EventAccessRecovery,
): string {
  const current = authoritativeAccess(overview, recovery);
  return current
    ? `${recoverySubject(recovery)} currently has ${current.role} access to this event.`
    : `${recoverySubject(recovery)} currently has no access to this event.`;
}

function appendGuidance(message: string, guidance: string): string {
  return `${message}${/[.!?]$/.test(message) ? " " : ". "}${guidance}`;
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
  const [recovery, setRecovery] = useState<EventAccessRecovery | null>(null);
  const grantSearchRef = useRef<HTMLInputElement>(null);
  const writeInFlight = useRef(false);
  const locked = busy || recovery !== null;
  useUnsavedWorkGuard(locked, { blocking: locked });

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

  function beginWrite(): boolean {
    if (writeInFlight.current || recovery !== null) return false;
    writeInFlight.current = true;
    setBusy(true);
    return true;
  }

  function endWrite(): void {
    writeInFlight.current = false;
    setBusy(false);
  }

  function completeRecovery(overview: EventAccessOverviewDTO, operation: EventAccessRecovery): void {
    applyOverview(overview);
    setRecovery(null);
    setPendingRemove(null);
    setGrantOpen(false);
    toast(`Event access checked: ${currentAccessDescription(overview, operation)}`);
  }

  async function removeAccess() {
    if (!pendingRemove || !beginWrite()) return;
    const removed = pendingRemove;
    try {
      await api(`events/${eventId}/access/${removed.userId}`, removedSchema, { method: "DELETE" });
      setMembers((current) => current.filter((member) => member.userId !== removed.userId));
      setPendingRemove(null);
      toast(`${removed.email} no longer has access to this event`);
      void requestOverview().then(applyOverview).catch(() => undefined);
    } catch (caught) {
      if (isDefinitiveWriteFailure(caught)) {
        setPendingRemove(null);
        try {
          applyOverview(await requestOverview());
          toast(caught.message, { kind: "error" });
        } catch {
          const message = appendGuidance(
            caught.message,
            "Event access could not be refreshed; reload before trying another access change.",
          );
          setError(message);
          toast(message, { kind: "error" });
        }
      } else {
        setPendingRemove(null);
        setRecovery({ action: "remove", member: removed, replayRejected: false });
        toast("That access removal is unconfirmed. Keep this page open and retry the exact removal or check event access.", { kind: "error" });
      }
    } finally {
      endWrite();
    }
  }

  function openGrant() {
    if (locked) return;
    setGrantSearch("");
    setSelectedUserId(null);
    setGrantRole("reviewer");
    setGrantError("");
    setGrantOpen(true);
  }

  function closeGrant() {
    if (locked) return;
    setGrantOpen(false);
    setGrantError("");
  }

  async function grantAccess() {
    if (!selectedUserId || locked) return;
    const candidate = candidates.find((person) => person.userId === selectedUserId);
    if (!candidate) {
      setGrantError("That teammate is no longer available. Choose another teammate.");
      return;
    }
    const operation: Extract<EventAccessRecovery, { action: "grant" }> = {
      action: "grant",
      candidate,
      requestedRole: grantRole,
      replayRejected: false,
    };
    if (!beginWrite()) return;
    setGrantError("");
    try {
      const granted = await api(
        `events/${eventId}/access/${candidate.userId}`,
        eventAccessMemberDtoSchema,
        { method: "PATCH", body: { role: operation.requestedRole } },
      );
      setMembers((current) => orderMembers([
        ...current.filter((member) => member.userId !== granted.userId),
        granted,
      ]));
      setCandidates((current) => current.filter((person) => person.userId !== granted.userId));
      setGrantOpen(false);
      toast(granted.role === operation.requestedRole
        ? `${candidate.name || candidate.email} can now open this event as ${granted.role}`
        : `${candidate.name || candidate.email} already has stronger ${granted.role} access`);
    } catch (caught) {
      if (isDefinitiveWriteFailure(caught)) {
        const staleOverview = caught.code === "FORBIDDEN" || caught.code === "NOT_FOUND";
        if (!staleOverview) {
          setGrantError(caught.message);
        } else {
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
            setGrantError(appendGuidance(caught.message, "Event access could not be refreshed; close this picker and reload before trying again."));
          }
        }
      } else {
        setGrantOpen(false);
        setRecovery(operation);
        toast("That access grant is unconfirmed. Keep this page open and retry the exact grant or check event access.", { kind: "error" });
      }
    } finally {
      endWrite();
    }
  }

  async function retryExactAction() {
    if (!recovery || writeInFlight.current) return;
    const operation = recovery;
    writeInFlight.current = true;
    setBusy(true);
    try {
      if (operation.action === "grant") {
        await api(
          `events/${eventId}/access/${operation.candidate.userId}`,
          eventAccessMemberDtoSchema,
          { method: "PATCH", body: { role: operation.requestedRole } },
        );
      } else {
        await api(`events/${eventId}/access/${operation.member.userId}`, removedSchema, { method: "DELETE" });
      }
      completeRecovery(await requestOverview(), operation);
    } catch (caught) {
      const definitive = isDefinitiveWriteFailure(caught);
      if (definitive) setRecovery({ ...operation, replayRejected: true });
      const message = definitive
        ? appendGuidance(caught.message, "Check current event access to finish recovery without repeating a rejected action.")
        : "The access change is still unconfirmed. Restore your connection, then retry this exact action or check event access.";
      toast(message, { kind: "error" });
    } finally {
      writeInFlight.current = false;
      setBusy(false);
    }
  }

  async function checkEventAccess() {
    if (!recovery || writeInFlight.current) return;
    const operation = recovery;
    writeInFlight.current = true;
    setBusy(true);
    try {
      const overview = await requestOverview();
      applyOverview(overview);
      if (operation.replayRejected || requestedStateIsCurrent(overview, operation)) {
        completeRecovery(overview, operation);
      } else {
        toast(`Event access checked: ${currentAccessDescription(overview, operation)} The earlier change may still be finishing; retry the exact action before leaving.`, { kind: "error" });
      }
    } catch (caught) {
      if (isDefinitiveWriteFailure(caught)) {
        const message = appendGuidance(
          caught.message,
          "The access change can’t be confirmed from this account. Leave this page or restore access and retry loading.",
        );
        setRecovery(null);
        setPendingRemove(null);
        setGrantOpen(false);
        setCanGrant(false);
        setCandidates([]);
        setError(message);
        toast(message, { kind: "error" });
      } else {
        toast("Event access still couldn’t be checked. Restore your connection or permissions and try again.", { kind: "error" });
      }
    } finally {
      writeInFlight.current = false;
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
        {!loading && !error && canGrant && <Button size="sm" disabled={locked} onClick={openGrant}><UserPlus size={14} /> Grant access</Button>}
      </header>
      <div style={{ padding: "0 24px 24px" }}>
        {recovery && <div className="locked-banner" role="alert">
          <AlertTriangle size={17} aria-hidden />
          <div>
            <b>Event access change unconfirmed</b>
            <span>We don’t know whether {recoverySubject(recovery)} currently has the requested access. The roster may be stale; other access changes and navigation are locked until recovery finishes.</span>
          </div>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void retryExactAction()}>
            {busy ? "Retrying…" : recovery.action === "grant" ? "Retry exact grant" : "Retry exact removal"}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void checkEventAccess()}>
            {busy ? "Checking…" : "Check event access"}
          </Button>
        </div>}
        {loading && <SkeletonText lines={3} label="Loading event access…" />}
        {error && <LoadFailure message={error} retrying={loading} onRetry={() => void load()} />}
        {!loading && !error && members.length === 0 && (
          <EmptyState icon={<KeyRound size={20} />} title="No event members" description="Every event should have an owner. Reload before making another access change." />
        )}
        {!loading && !error && members.length > 0 && <div className="team-event-access-list event-access-roster">
          {members.map((member) => <article key={member.userId}>
            <div><b>{member.name || member.email}</b><small>{member.email}</small></div>
            <StatusBadge value={member.role} />
            <small>{member.organizationMember ? "Current organization teammate" : "No longer in this organization"}</small>
            {member.canRemove
              ? <Button size="sm" variant="danger" disabled={locked} onClick={() => setPendingRemove(member)}><UserMinus size={14} /> Remove access</Button>
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
        <Button variant="secondary" disabled={locked} onClick={closeGrant}>Cancel</Button>
        <Button disabled={locked || !selectedCandidate} onClick={() => void grantAccess()}>
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
                  disabled={locked}
                  value={grantSearch}
                  onChange={(event) => {
                    setGrantSearch(event.target.value);
                    setSelectedUserId(null);
                    setGrantError("");
                  }}
                  placeholder="Search by name or email"
                />
              </div>
            </Field>
            <div className="event-access-candidates" role="group" aria-label="Available teammates">
              {filteredCandidates.map((candidate) => <button
                key={candidate.userId}
                type="button"
                disabled={locked}
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
              <Select disabled={locked} value={grantRole} onChange={(event) => setGrantRole(event.target.value as GrantRole)}>
                <option value="reviewer">Reviewer</option>
                <option value="organizer">Organizer</option>
              </Select>
              <small>Reviewers evaluate submissions. Organizers can manage the entire event.</small>
            </Field>
          </div>}
      {grantError && <p className="field-error" role="alert">{grantError}</p>}
    </Modal>
    <ConfirmDialog
      open={pendingRemove !== null && recovery === null}
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
