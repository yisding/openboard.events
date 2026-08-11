"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Contact2, Copy, FileText, Plus, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import type { BuilderEvent, BuilderForm, FormListRow } from "@/features/forms";
import type { TaskTarget } from "@/shared/contracts";
import { Button, EmptyState, Field, Modal } from "@/shared/ui/ui-kit";
import { formatInZone } from "@/shared/lib/time";
import { useToast } from "@/shared/ui/toast";

async function requestData<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload = await response.json() as { data?: T; error?: { message?: string } };
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message ?? "The request could not be completed");
  return payload.data;
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
  const visible = useMemo(
    () => forms.filter((form) => form.internalName.toLowerCase().includes(search.trim().toLowerCase())),
    [forms, search],
  );

  async function createForm() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const form = await requestData<BuilderForm>(`/api/internal/forms?eventId=${event.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // `kind`/`collectParticipants` are CFP-only concepts with no meaning
        // for a portal form; `createFormIn` still requires the columns (NOT
        // NULL with a default), so fixed, inert values travel here rather
        // than surfacing a choice the organizer never needs to make.
        body: JSON.stringify({ internalName: name, kind: "abstract", collectParticipants: false, context: "portal", targetType }),
      });
      toast("Portal form created");
      router.push(`/events/${event.id}/tasks/forms/${form.id}`);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "The form could not be created");
      setBusy(false);
    }
  }

  async function duplicateForm(form: FormListRow) {
    try {
      const copy = await requestData<BuilderForm>(`/api/internal/forms/${form.id}/duplicate?eventId=${event.id}`, { method: "POST" });
      toast("Form duplicated as a new draft");
      router.push(`/events/${event.id}/tasks/forms/${copy.id}`);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "The form could not be duplicated");
    }
  }

  async function deleteForm(form: FormListRow) {
    if (!window.confirm(`Delete "${form.internalName}"? This cannot be undone.`)) return;
    try {
      await requestData(`/api/internal/forms/${form.id}?eventId=${event.id}`, { method: "DELETE" });
      setForms((current) => current.filter((candidate) => candidate.id !== form.id));
      toast("Form deleted");
    } catch (error) {
      // The FK-RESTRICT precheck (`deleteFormIn`) surfaces here verbatim —
      // the same "revert task to manual first" copy M23 shows for a
      // referenced file request.
      toast(error instanceof Error ? error.message : "The form could not be deleted");
    }
  }

  return <>
    <header className="page-header">
      <div>
        <div className="page-eyebrow">PORTAL</div>
        <h1>Portal Forms</h1>
        <p>Collect contact and session updates from speakers through a task on their portal — never a public CFP link.</p>
      </div>
      <div className="page-actions"><Button onClick={() => setCreating(true)}><Plus size={16} /> Create form</Button></div>
    </header>
    <section className="panel list-panel">
      <div className="list-toolbar">
        <input aria-label="Search forms" placeholder="Search forms" value={search} onChange={(current) => setSearch(current.target.value)} />
      </div>
      {visible.length === 0 ? (
        <EmptyState icon={<FileText />} title="No portal forms yet" description="Create a form so speakers can update their information from a task." />
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
                <button className="icon-button" title="Duplicate form" onClick={() => void duplicateForm(form)}><Copy size={17} /></button>
                <button className="icon-button" title="Delete form" onClick={() => void deleteForm(form)}><Trash2 size={17} /></button>
                <Link className="button button-secondary" href={`/events/${event.id}/tasks/forms/${form.id}`}>Edit form</Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
    <Modal
      open={creating}
      onClose={() => setCreating(false)}
      title="Create a portal form"
      description="Speakers fill this out from a task on their portal."
      footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={!name.trim() || busy} onClick={() => void createForm()}>{busy ? "Creating…" : "Create form"}</Button></>}
    >
      <div className="form-stack">
        <Field label="Internal form name" required><input autoFocus required maxLength={255} value={name} onChange={(current) => setName(current.target.value)} placeholder="e.g. Update Your Information" /></Field>
        <Field label="What does this form edit?" hint="Cannot be changed after creation." group>
          <div className="choice-cards">
            <button type="button" aria-pressed={targetType === "contact"} className={targetType === "contact" ? "active" : ""} onClick={() => setTargetType("contact")}><Contact2 size={20} /><b>Contact</b><small>Bio, headshot, pronouns, company, job title</small></button>
            <button type="button" aria-pressed={targetType === "submission"} className={targetType === "submission" ? "active" : ""} onClick={() => setTargetType("submission")}><FileText size={20} /><b>Submission</b><small>Session title, description, level</small></button>
          </div>
        </Field>
      </div>
    </Modal>
  </>;
}
