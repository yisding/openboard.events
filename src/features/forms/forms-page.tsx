"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, Copy, ExternalLink, FileEdit, FileText, MoreHorizontal, Plus, Send, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useDemo } from "@/shared/demo/demo-provider";
import { Button, Field, Modal, PageHeader, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import type { FormRecord } from "@/shared/demo/types";
import { slugify } from "@/shared/lib/slug";

export function FormsPage() {
  const { state, dispatch } = useDemo();
  const { toast } = useToast();
  const router = useRouter();
  const event = state.events[0];
  const [tab, setTab] = useState<"all" | "open" | "draft" | "closed">("all");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [context, setContext] = useState<"cfp" | "portal">("cfp");
  const forms = useMemo(() => state.forms.filter((form) => tab === "all" || form.status === tab), [state.forms, tab]);

  function createForm() {
    if (!name.trim() || !event) return;
    const id = `${slugify(name)}-${Date.now().toString().slice(-5)}`;
    const form: FormRecord = {
      id, eventId: event.id, slug: id, name: name.trim(), status: "draft", version: 1, opensAt: "", closesAt: "", submissionLimit: 500, maxPerSpeaker: 3, submissions: 0,
      welcomeTitle: context === "cfp" ? "We’d love to hear your idea" : "A few details before the event", welcomeBody: "Complete this short form and our team will take it from here.", successTitle: "You’re all set", successBody: "Thanks! Your response has been saved.",
      sections: [{ id: `sec_${Date.now()}`, title: context === "cfp" ? "Your session" : "Your details", description: "Add the information our team needs.", fields: [
        { id: `fld_title_${Date.now()}`, key: "title", label: context === "cfp" ? "Session title" : "Response title", type: "text", required: true, locked: true, helpText: "", placeholder: "Enter a title", maxChars: 120, options: [] },
        { id: `fld_first_${Date.now()}`, key: "first_name", label: "First name", type: "text", required: true, locked: true, helpText: "", placeholder: "First name", maxChars: 80, options: [] },
        { id: `fld_last_${Date.now()}`, key: "last_name", label: "Last name", type: "text", required: true, locked: true, helpText: "", placeholder: "Last name", maxChars: 80, options: [] },
        { id: `fld_email_${Date.now()}`, key: "email", label: "Email", type: "email", required: true, locked: true, helpText: "", placeholder: "you@company.com", maxChars: 254, options: [] },
      ] }],
    };
    dispatch({ type: "ADD_FORM", form });
    toast("Form created — let’s make it yours");
    router.push(`/events/${event.id}/forms/${form.id}`);
  }

  return <><PageHeader eyebrow="PROGRAM" title="Forms" description="Build calls for speakers and collect everything your program needs." actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> New form</Button>} />
    <section className="summary-row"><article><span className="summary-icon purple"><FileText size={19} /></span><div><strong>{state.forms.length}</strong><small>Total forms</small></div></article><article><span className="summary-icon green"><Send size={19} /></span><div><strong>{state.forms.filter((form) => form.status === "open").length}</strong><small>Currently open</small></div></article><article><span className="summary-icon blue"><Users size={19} /></span><div><strong>247</strong><small>Total responses</small></div></article><article><span className="summary-icon amber"><CalendarClock size={19} /></span><div><strong>23 days</strong><small>Until CFP closes</small></div></article></section>
    <section className="panel list-panel"><div className="list-toolbar"><div className="tabs">{(["all", "open", "draft", "closed"] as const).map((value) => <button key={value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{value[0]?.toUpperCase()}{value.slice(1)}<span>{value === "all" ? state.forms.length : state.forms.filter((form) => form.status === value).length}</span></button>)}</div></div><div className="form-cards">{forms.map((form) => <article className="form-list-card" key={form.id}><div className="form-list-icon"><FileEdit size={22} /></div><div className="form-list-main"><div><h2>{form.name}</h2><StatusBadge value={form.status} /></div><p>{form.status === "open" ? "Collecting proposals from your public call for speakers." : "Finish setup, fields, and settings before publishing."}</p><div className="form-list-meta"><span><Users size={14} /> {form.submissions} submissions</span><span><FileText size={14} /> {form.sections.reduce((count, section) => count + section.fields.length, 0)} fields</span><span>Version {form.version}</span></div></div><div className="form-list-actions">{form.status === "open" && <Link className="icon-button" href={`/submit/${event?.slug ?? "ai-engineer"}/${form.id}`} target="_blank" title="Open public form"><ExternalLink size={17} /></Link>}<button className="icon-button" title="Duplicate" onClick={() => toast("Form settings duplicated into a new draft")}><Copy size={17} /></button><button className="icon-button"><MoreHorizontal size={18} /></button><Link className="button button-secondary" href={`/events/${event?.id ?? ""}/forms/${form.id}`}>Edit form</Link></div></article>)}</div></section>
    <Modal open={creating} onClose={() => setCreating(false)} title="Create a new form" description="Start with the locked identity fields, then add your own questions." footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={!name.trim()} onClick={createForm}>Create form</Button></>}><div className="form-stack"><Field label="Form name" required><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Lightning Talks" /></Field><Field label="What is this form for?"><div className="choice-cards"><button className={context === "cfp" ? "active" : ""} onClick={() => setContext("cfp")}><FileText size={20} /><b>Call for speakers</b><small>Public proposals, participants, and review</small>{context === "cfp" && <CheckCircle2 size={16} />}</button><button className={context === "portal" ? "active" : ""} onClick={() => setContext("portal")}><Users size={20} /><b>Speaker onboarding</b><small>Collect details from accepted speakers</small>{context === "portal" && <CheckCircle2 size={16} />}</button></div></Field></div></Modal>
  </>;
}
