"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Copy, ExternalLink, Eye, FileEdit, FileText, Plus, Search, Send, Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { BuilderEvent, BuilderForm, FormListRow } from "./builder-types";
import { duplicateFormAsDraft, formDuplicateOutcomeUnknown } from "./duplicate-form";
import { formAvailability, type FormAvailability } from "./lib/form-open";
import { Button, EmptyState, Field, Modal, PageHeader, SearchInput, StatusBadge, Switch } from "@/shared/ui/ui-kit";
import { formatInZone } from "@/shared/lib/time";
import { createStableCreateRequestId } from "@/shared/lib/stable-create-request-id";
import { copyText } from "@/shared/ui/app/copy-text";
import { useToast } from "@/shared/ui/toast";
import {
  closeFormCreateLifecycle,
  formCreateOutcomeUnknown,
  openFormCreateLifecycle,
  requestFormCreate,
} from "./form-create-request";

const formTabs: ReadonlyArray<{ value: "all" | FormAvailability; label: string }> = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "scheduled", label: "Scheduled" },
  { value: "draft", label: "Draft" },
  { value: "ended", label: "Ended" },
  { value: "closed", label: "Closed" },
];

export function FormsPage({ event, initialForms }: { event: BuilderEvent; initialForms: FormListRow[] }) {
  const { toast } = useToast();
  const router = useRouter();
  const forms = initialForms;
  const [tab, setTab] = useState<"all" | FormAvailability>("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"abstract" | "session">("abstract");
  const [collectParticipants, setCollectParticipants] = useState(true);
  const [busy, setBusy] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const createRequestId = useRef(createStableCreateRequestId());
  const createOutcomeUnknown = useRef(false);
  const visible = useMemo(() => forms.filter((form) => {
    const tabMatch = tab === "all" || form.availability === tab;
    const searchMatch = form.internalName.toLowerCase().includes(search.trim().toLowerCase());
    return tabMatch && searchMatch;
  }), [forms, search, tab]);

  function openCreate() {
    openFormCreateLifecycle(createRequestId.current, createOutcomeUnknown.current);
    setCreating(true);
  }

  function closeCreate() {
    if (!closeFormCreateLifecycle(createRequestId.current, createOutcomeUnknown.current, busy)) return;
    setCreating(false);
  }

  async function createForm() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const form = await requestFormCreate<BuilderForm>(`/api/internal/forms?eventId=${event.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createRequestId.current.payload(undefined, { internalName: name, kind, collectParticipants })),
      });
      createRequestId.current.reset();
      createOutcomeUnknown.current = false;
      setRecoveryRequired(false);
      toast("Form created with the required submission and identity fields");
      router.push(`/events/${event.id}/forms/${form.id}`);
      router.refresh();
    } catch (error) {
      const outcomeUnknown = formCreateOutcomeUnknown(error);
      createOutcomeUnknown.current = outcomeUnknown;
      setRecoveryRequired(outcomeUnknown);
      toast(error instanceof Error ? error.message : "The form could not be created", { kind: "error" });
      setBusy(false);
    }
  }

  async function copyLink(form: FormListRow) {
    if (formAvailability(form, new Date().toISOString()) !== "live") {
      toast("This form is not live, so its public link was not copied", { kind: "error" });
      router.refresh();
      return;
    }

    const copied = await copyText(`${window.location.origin}/submit/${event.slug}/${form.id}`);
    toast(copied ? "Live form link copied" : "Couldn’t copy the live link. Open it and copy the address from your browser.", copied ? undefined : { kind: "error" });
  }

  function openLiveForm(current: React.MouseEvent<HTMLAnchorElement>, form: FormListRow) {
    if (formAvailability(form, new Date().toISOString()) === "live") return;
    current.preventDefault();
    toast("This form is no longer live. Refreshing its availability…", { kind: "error" });
    router.refresh();
  }

  async function duplicateAsDraft(form: FormListRow) {
    if (busy || duplicatingId !== null) return;
    setDuplicatingId(form.id);
    try {
      const copy = await duplicateFormAsDraft(event.id, form.id);
      toast(`${form.internalName} duplicated as a new draft`);
      router.push(`/events/${event.id}/forms/${copy.id}`);
      router.refresh();
    } catch (error) {
      const unknown = formDuplicateOutcomeUnknown(error);
      toast(unknown
        ? "Couldn’t confirm whether the draft copy was created. Refresh the form list before trying again."
        : error instanceof Error ? error.message : "The form could not be duplicated", { kind: "error" });
      if (unknown) router.refresh();
    } finally {
      setDuplicatingId(null);
    }
  }

  const totalSubmissions = forms.reduce((total, form) => total + form.submissionCount, 0);
  const totalDrafts = forms.reduce((total, form) => total + form.draftCount, 0);
  // "No forms here" meant three unrelated things, and the one that reads as an
  // accusation is telling an organizer with 30 forms to create one. Each
  // emptiness now names what emptied the list and offers the way back.
  const searchActive = search.trim() !== "";
  const emptyState = forms.length === 0
    ? <EmptyState
      icon={<FileText />}
      title="No forms yet"
      description="Create a form to start collecting abstracts, sessions, or participant details."
      action={<Button onClick={openCreate}><Plus size={16} /> Create form</Button>}
    />
    : searchActive
      ? <EmptyState
        icon={<Search />}
        title="No forms match that search"
        description={`Clear the search to see ${forms.length === 1 ? "the one form" : `all ${forms.length} forms`} on this event.`}
        action={<Button variant="secondary" onClick={() => setSearch("")}>Clear search</Button>}
      />
      : <EmptyState
        icon={<FileText />}
        title={`No ${formTabs.find((candidate) => candidate.value === tab)?.label.toLowerCase() ?? ""} forms`}
        description="Nothing on this event is in that state right now."
        action={<Button variant="secondary" onClick={() => setTab("all")}>Show all forms</Button>}
      />;
  return <>
    <PageHeader
      eyebrow="PROGRAM"
      title="Submission Forms"
      description="Collect abstract, session and participant information for your event."
      actions={<Button onClick={openCreate}><Plus size={16} /> Create form</Button>}
    />
    <section className="summary-row">
      <article><span className="summary-icon accent"><FileText size={19} /></span><div><strong>{forms.length}</strong><small>Total forms</small></div></article>
      <article><span className="summary-icon"><Send size={19} /></span><div><strong>{forms.filter((form) => form.availability === "live").length}</strong><small>Live now</small></div></article>
      <article><span className="summary-icon"><Users size={19} /></span><div><strong>{totalSubmissions}</strong><small>Submissions</small></div></article>
      <article><span className="summary-icon"><CalendarClock size={19} /></span><div><strong>{totalDrafts}</strong><small>Speaker drafts</small></div></article>
    </section>
    <section className="panel list-panel">
      <div className="list-toolbar form-list-toolbar">
        <div className="tabs" role="group" aria-label="Form filters">{formTabs.map(({ value, label }) => <button type="button" key={value} aria-pressed={tab === value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{label}<span>{value === "all" ? forms.length : forms.filter((form) => form.availability === value).length}</span></button>)}</div>
        <SearchInput label="Search forms" placeholder="Search forms" value={search} onChange={setSearch} />
      </div>
      {visible.length === 0 ? emptyState : <div className="form-cards">{visible.map((form) => <article className="form-list-card" key={form.id}>
        <div className="form-list-icon"><FileEdit size={22} /></div>
        <div className="form-list-main"><div><h2><Link className="form-list-title-link" href={`/events/${event.id}/forms/${form.id}`}>{form.internalName}</Link></h2><StatusBadge value={form.availability} /></div><p>{form.externalTitle || "Untitled public form"}</p><div className="form-list-meta">
          <span><Users size={14} /> {form.submissionCount} submissions</span>
          <span><FileText size={14} /> {form.draftCount} drafts</span>
          <span>Version {form.currentVersion}</span>
          {form.availability === "scheduled" && form.opensAt && <span>Opens {formatInZone(form.opensAt, event.timezone, "date")}</span>}
          {form.availability === "live" && form.closesAt && <span>Closes {formatInZone(form.closesAt, event.timezone, "date")}</span>}
          {form.availability === "ended" && form.closesAt && <span>Ended {formatInZone(form.closesAt, event.timezone, "date")}</span>}
          <span>Created {formatInZone(form.createdAt, event.timezone, "date")}</span>
        </div></div>
        <div className="form-list-actions">
          {form.availability === "live" ? <>
            <Link className="icon-button" href={`/submit/${event.slug}/${form.id}`} target="_blank" rel="noreferrer" title={`Open live form: ${form.internalName}`} aria-label={`Open live form: ${form.internalName}`} onClick={(current) => openLiveForm(current, form)}><ExternalLink size={17} /></Link>
            <button type="button" className="icon-button" title={`Copy live link: ${form.internalName}`} aria-label={`Copy live link: ${form.internalName}`} onClick={() => void copyLink(form)}><Copy size={17} /></button>
          </> : <Link className="button button-secondary" href={`/events/${event.id}/forms/${form.id}/preview`} target="_blank" rel="noreferrer"><Eye size={16} /> Preview</Link>}
          <Button
            variant="secondary"
            disabled={busy || duplicatingId !== null}
            title="Creates a new draft without submissions, routing rules, or opening and closing dates"
            aria-label={`Duplicate ${form.internalName} as a draft without submissions, routing rules, or opening and closing dates`}
            onClick={() => void duplicateAsDraft(form)}
          >
            <Copy size={16} /> {duplicatingId === form.id ? "Duplicating…" : "Duplicate as draft"}
          </Button>
          <Link className="button button-secondary" href={`/events/${event.id}/forms/${form.id}`}>Edit form</Link>
        </div>
      </article>)}</div>}
    </section>
    <Modal open={creating} onClose={closeCreate} title="Create a submission form" description="The required Title, First Name, Last Name, and Email questions are locked in automatically." footer={<><Button variant="secondary" disabled={busy} onClick={closeCreate}>Cancel</Button><Button disabled={!name.trim() || busy} onClick={() => void createForm()}>{busy ? "Creating…" : recoveryRequired ? "Retry form creation" : "Create form"}</Button></>}>
      <div className="form-stack">
        <Field label="Internal form name" required><input autoFocus required disabled={busy || recoveryRequired} maxLength={255} value={name} onChange={(current) => setName(current.target.value)} placeholder="e.g. Main call for speakers" /></Field>
        <Field label="Submission type" group><div className="choice-cards">
          <button type="button" disabled={busy || recoveryRequired} aria-pressed={kind === "abstract"} className={kind === "abstract" ? "active" : ""} onClick={() => setKind("abstract")}><FileText size={20} /><b>Abstract</b><small>Collect talk submissions for review</small></button>
          <button type="button" disabled={busy || recoveryRequired} aria-pressed={kind === "session"} className={kind === "session" ? "active" : ""} onClick={() => setKind("session")}><CalendarClock size={20} /><b>Session</b><small>Collect complete session details</small></button>
        </div></Field>
        <div className="inline-setting"><div><b>Collect participant information</b><small>Add the required speaker identity section.</small></div><Switch label="Collect participant information" checked={collectParticipants} disabled={busy || recoveryRequired} onClick={() => setCollectParticipants((value) => !value)} /></div>
        {recoveryRequired && <p className="portal-note" role="status">Creation could not be confirmed. Retry with the same details before making changes.</p>}
      </div>
    </Modal>
  </>;
}
