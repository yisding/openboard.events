"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Contact2, Copy, FileText, Plus, Trash2, Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { BuilderEvent, BuilderForm, FormListRow } from "@/features/forms";
import {
  closeFormCreateLifecycle,
  formCreateOutcomeUnknown,
  openFormCreateLifecycle,
  requestFormCreate,
} from "@/features/forms/form-create-request";
import type { TaskTarget } from "@/shared/contracts";
import { createStableCreateRequestId } from "@/shared/lib/stable-create-request-id";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { Button, EmptyState, Field, Modal } from "@/shared/ui/ui-kit";
import { formatInZone } from "@/shared/lib/time";
import { useToast } from "@/shared/ui/toast";

async function requestPortalData<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok || payload?.data === undefined) throw new Error(payload?.error?.message ?? "The request could not be completed");
  return payload.data;
}

export type PortalFormRowAction = "duplicate" | "delete";

export function claimPortalFormRowAction(
  actions: Map<string, PortalFormRowAction>,
  formId: string,
  action: PortalFormRowAction,
): boolean {
  if (actions.has(formId)) return false;
  actions.set(formId, action);
  return true;
}

/**
 * M24 §3 — the portal forms list. Never shows a `context='cfp'` form and
 * vice versa: this page fetches `listForms(eventId, "portal")` server-side
 * (see the route at `app/events/[eventId]/tasks/forms/page.tsx`), the exact
 * disjoint-set guarantee M12's `listFormsIn` provides by filtering on
 * `context` in SQL, not client-side.
 */
export function PortalFormsPage({ event, initialForms }: { event: BuilderEvent; initialForms: FormListRow[] }) {
  const { toast } = useToast();
  const router = useRouter();
  const [forms, setForms] = useState(initialForms);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [targetType, setTargetType] = useState<TaskTarget>("contact");
  const [busy, setBusy] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FormListRow | null>(null);
  const [rowActions, setRowActions] = useState<Record<string, PortalFormRowAction>>({});
  const rowActionsRef = useRef(new Map<string, PortalFormRowAction>());
  const createRequestId = useRef(createStableCreateRequestId());
  const createOutcomeUnknown = useRef(false);
  const visible = useMemo(
    () => forms.filter((form) => form.internalName.toLowerCase().includes(search.trim().toLowerCase())),
    [forms, search],
  );
  const searchActive = search.trim().length > 0;

  function openCreate() {
    openFormCreateLifecycle(createRequestId.current, createOutcomeUnknown.current);
    if (!createOutcomeUnknown.current) setRecoveryRequired(false);
    setCreating(true);
  }

  function closeCreate() {
    if (!closeFormCreateLifecycle(createRequestId.current, createOutcomeUnknown.current, busy)) return;
    setCreating(false);
  }

  function claimRowAction(formId: string, action: PortalFormRowAction): boolean {
    if (!claimPortalFormRowAction(rowActionsRef.current, formId, action)) return false;
    setRowActions((current) => ({ ...current, [formId]: action }));
    return true;
  }

  function releaseRowAction(formId: string) {
    rowActionsRef.current.delete(formId);
    setRowActions((current) => {
      if (!current[formId]) return current;
      const next = { ...current };
      delete next[formId];
      return next;
    });
  }

  async function createForm() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const form = await requestFormCreate<BuilderForm>(`/api/internal/forms?eventId=${event.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // `kind`/`collectParticipants` are CFP-only concepts with no meaning
        // for a portal form; `createFormIn` still requires the columns (NOT
        // NULL with a default), so fixed, inert values travel here rather
        // than surfacing a choice the organizer never needs to make.
        body: JSON.stringify(createRequestId.current.payload(undefined, {
          internalName: name,
          kind: "abstract",
          collectParticipants: false,
          context: "portal",
          targetType,
        })),
      });
      createRequestId.current.reset();
      createOutcomeUnknown.current = false;
      setRecoveryRequired(false);
      toast("Portal form created");
      router.push(`/events/${event.id}/tasks/forms/${form.id}`);
      router.refresh();
    } catch (error) {
      const outcomeUnknown = formCreateOutcomeUnknown(error);
      createOutcomeUnknown.current = outcomeUnknown;
      setRecoveryRequired(outcomeUnknown);
      toast(error instanceof Error ? error.message : "The form could not be created", { kind: "error" });
      setBusy(false);
    }
  }

  async function duplicateForm(form: FormListRow) {
    if (!claimRowAction(form.id, "duplicate")) return;
    try {
      const copy = await requestPortalData<BuilderForm>(`/api/internal/forms/${form.id}/duplicate?eventId=${event.id}`, { method: "POST" });
      toast("Form duplicated as a new draft");
      router.push(`/events/${event.id}/tasks/forms/${copy.id}`);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "The form could not be duplicated", { kind: "error" });
    } finally {
      releaseRowAction(form.id);
    }
  }

  async function deleteForm(form: FormListRow) {
    if (!claimRowAction(form.id, "delete")) return;
    try {
      await requestPortalData(`/api/internal/forms/${form.id}?eventId=${event.id}`, { method: "DELETE" });
      setForms((current) => current.filter((candidate) => candidate.id !== form.id));
      setPendingDelete(null);
      toast("Form deleted");
    } catch (error) {
      // The FK-RESTRICT precheck (`deleteFormIn`) surfaces here verbatim —
      // the same "revert task to manual first" copy M23 shows for a
      // referenced file request.
      toast(error instanceof Error ? error.message : "The form could not be deleted", { kind: "error" });
    } finally {
      releaseRowAction(form.id);
    }
  }

  return <>
    <header className="page-header">
      <div>
        <div className="page-eyebrow">PORTAL</div>
        <h1>Portal Forms</h1>
        <p>Collect contact and session updates from speakers through a task on their portal — never a public CFP link.</p>
      </div>
      <div className="page-actions"><Button onClick={openCreate}><Plus size={16} /> Create form</Button></div>
    </header>
    <section className="panel list-panel">
      <div className="list-toolbar form-list-toolbar">
        <input aria-label="Search forms" placeholder="Search forms" value={search} onChange={(current) => setSearch(current.target.value)} />
      </div>
      {visible.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={searchActive ? "No portal forms match" : "No portal forms yet"}
          description={searchActive ? "Try another name or clear the search." : "Create a form so speakers can update their information from a task."}
          {...(searchActive ? { action: <Button variant="secondary" onClick={() => setSearch("")}>Clear search</Button> } : {})}
        />
      ) : (
        <div className="form-cards">
          {visible.map((form) => (
            <article className="form-list-card" key={form.id}>
              <div className="form-list-icon">{form.targetType === "submission" ? <Users size={22} /> : <Contact2 size={22} />}</div>
              <div className="form-list-main">
                <div><h2>{form.internalName}</h2><span className={`status-badge status-${form.targetType ?? "contact"}`}><i />{form.targetType === "submission" ? "Submission" : "Contact"}</span></div>
                <p>{form.externalTitle || "Untitled portal form"}</p>
                <div className="form-list-meta">
                  <span>Version {form.currentVersion}</span>
                  <span>Created {formatInZone(form.createdAt, event.timezone, "date")}</span>
                </div>
              </div>
              <div className="form-list-actions">
                <button
                  type="button"
                  className="icon-button"
                  title={`Duplicate ${form.internalName}`}
                  aria-label={rowActions[form.id] === "duplicate" ? `Duplicating ${form.internalName}` : `Duplicate ${form.internalName}`}
                  disabled={Boolean(rowActions[form.id])}
                  onClick={() => void duplicateForm(form)}
                ><Copy size={17} aria-hidden /></button>
                <button
                  type="button"
                  className="icon-button"
                  title={`Delete ${form.internalName}`}
                  aria-label={`Delete ${form.internalName}`}
                  disabled={Boolean(rowActions[form.id])}
                  onClick={() => setPendingDelete(form)}
                ><Trash2 size={17} aria-hidden /></button>
                <Link className="button button-secondary" href={`/events/${event.id}/tasks/forms/${form.id}`}>Edit form</Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
    <Modal
      open={creating}
      onClose={closeCreate}
      title="Create a portal form"
      description="Speakers fill this out from a task on their portal."
      footer={<><Button variant="secondary" disabled={busy} onClick={closeCreate}>Cancel</Button><Button disabled={!name.trim() || busy} onClick={() => void createForm()}>{busy ? "Creating…" : recoveryRequired ? "Retry form creation" : "Create form"}</Button></>}
    >
      <div className="form-stack">
        <Field label="Internal form name" required><input required disabled={busy || recoveryRequired} maxLength={255} value={name} onChange={(current) => setName(current.target.value)} placeholder="e.g. Update Your Information" /></Field>
        <Field label="What does this form edit?" hint="Cannot be changed after creation." group>
          <div className="choice-cards">
            <button type="button" disabled={busy || recoveryRequired} aria-pressed={targetType === "contact"} className={targetType === "contact" ? "active" : ""} onClick={() => setTargetType("contact")}><Contact2 size={20} /><b>Contact</b><small>Bio, headshot, pronouns, company, job title</small></button>
            <button type="button" disabled={busy || recoveryRequired} aria-pressed={targetType === "submission"} className={targetType === "submission" ? "active" : ""} onClick={() => setTargetType("submission")}><FileText size={20} /><b>Submission</b><small>Session title, description, level</small></button>
          </div>
        </Field>
        {recoveryRequired && <p className="portal-note" role="status">Creation could not be confirmed. Retry with the same details before making changes.</p>}
      </div>
    </Modal>
    <ConfirmDialog
      open={pendingDelete !== null}
      title={`Delete ${pendingDelete?.internalName ?? "this form"}?`}
      body="The form and its draft questions will be permanently removed. A form attached to a task cannot be deleted until the task is changed. This cannot be undone."
      confirmLabel="Delete form"
      onConfirm={async () => { if (pendingDelete) await deleteForm(pendingDelete); }}
      onCancel={() => setPendingDelete(null)}
    />
  </>;
}
