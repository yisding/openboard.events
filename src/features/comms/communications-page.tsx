"use client";

import { CheckCircle2, Clock3, Edit3, Mail, MoreHorizontal, Search, Send, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useDemo } from "@/shared/demo/demo-provider";
import { Button, Drawer, Field, Modal, PageHeader, Select, StatusBadge, Switch } from "@/shared/ui/ui-kit";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { useToast } from "@/shared/ui/toast";
import { sanitize } from "@/shared/lib/sanitize";
import { formatInZone } from "@/shared/lib/time";

type Tab="activity"|"templates"|"reminders";type Template={key:string;name:string;trigger:string;subject:string;body:string;enabled:boolean};
const defaultTemplates:Template[]=[
  {key:"submission_received",name:"Submission received",trigger:"When a proposal is submitted",subject:"We received {{submission.title}}",body:"<p>Thanks {{contact.first_name}}! Your proposal is safely in. We’ll be in touch after review closes.</p>",enabled:true},
  {key:"decision_accepted",name:"Decision — accepted",trigger:"Organizer clicks Notify",subject:"You’re speaking at {{event.name}}!",body:"<p>Great news, {{contact.first_name}}—we’d love to have you join us. Open your portal to see next steps.</p>",enabled:true},
  {key:"decision_declined",name:"Decision — declined",trigger:"Organizer clicks Notify",subject:"An update on {{submission.title}}",body:"<p>Thank you for sharing your idea. We’re unable to include it in this year’s program.</p>",enabled:true},
  {key:"task_assigned",name:"Task assigned",trigger:"New onboarding assignment",subject:"A new speaker task for {{event.name}}",body:"<p>There’s a new item waiting in your speaker portal.</p>",enabled:true},
  {key:"task_reminder",name:"Task reminder",trigger:"T–7, T–1, or overdue",subject:"Reminder: {{task.title}}",body:"<p>A quick reminder that your speaker task is due soon.</p>",enabled:true},
  {key:"session_scheduled",name:"Calendar invitation",trigger:"Session is published",subject:"Your {{event.name}} session is scheduled",body:"<p>Your session time is confirmed. Calendar files and quick-add links are attached.</p>",enabled:true},
  {key:"session_changed",name:"Schedule changed",trigger:"Published session moves",subject:"Schedule update for {{session.title}}",body:"<p>Your session schedule has changed. Please use the updated calendar invitation.</p>",enabled:true},
];
type Audience = "unconfirmed" | "confirmed" | "current";

function fillDemoVariables(value: string, firstName: string, eventName: string): string {
  return value
    .replaceAll("{{contact.first_name}}", firstName)
    .replaceAll("{{event.name}}", eventName)
    .replaceAll("{{submission.title}}", "your proposal")
    .replaceAll("{{task.title}}", "your speaker task")
    .replaceAll("{{session.title}}", "your session")
    .replaceAll("{{portal.url}}", "your speaker portal");
}

function plainTextEmail(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function CommunicationsPage() {
  const { state, dispatch } = useDemo();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("activity");
  const [search, setSearch] = useState("");
  const [templates, setTemplates] = useState(defaultTemplates);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [logId, setLogId] = useState<string | null>(null);
  const [sendModal, setSendModal] = useState(false);
  const [audience, setAudience] = useState<Audience>("unconfirmed");
  const [sendTemplateKey, setSendTemplateKey] = useState("task_reminder");
  const logs = useMemo(
    () => state.communications.filter((item) => `${item.recipient} ${item.subject} ${item.template}`.toLowerCase().includes(search.toLowerCase())),
    [search, state.communications],
  );
  const recipients = useMemo(() => state.speakers.filter((speaker) => {
    if (audience === "unconfirmed") return speaker.confirmation === "unconfirmed";
    if (audience === "confirmed") return speaker.confirmation === "confirmed";
    return speaker.confirmation !== "declined";
  }), [audience, state.speakers]);
  const activeLog = state.communications.find((item) => item.id === logId);
  const activeTemplate = templates.find((item) => item.key === editKey);
  const sendTemplate = templates.find((item) => item.key === sendTemplateKey && item.enabled);
  const eventZone = (eventId: string) => state.events.find((event) => event.id === eventId)?.timezone ?? "UTC";

  function sendMessage() {
    if (!sendTemplate || recipients.length === 0) {
      toast("Choose an audience with at least one recipient and an active template", { kind: "error" });
      return;
    }
    const queuedAt = Date.now();
    for (const [index, recipient] of recipients.entries()) {
      const eventName = state.events.find((event) => event.id === recipient.eventId)?.name ?? "your event";
      dispatch({
        type: "ADD_COMMUNICATION",
        communication: {
          id: `com_${queuedAt}_${index}`,
          eventId: recipient.eventId,
          recipient: recipient.email,
          subject: fillDemoVariables(sendTemplate.subject, recipient.firstName, eventName),
          template: sendTemplate.name,
          status: "queued",
          sentAt: new Date(queuedAt).toISOString(),
          preview: fillDemoVariables(plainTextEmail(sendTemplate.body), recipient.firstName, eventName),
        },
      });
    }
    setSendModal(false);
    toast(`${recipients.length} ${recipients.length === 1 ? "message" : "messages"} queued`);
  }

  return (
    <div className="communications-page">
      <PageHeader
        eyebrow="ENGAGE"
        title="Communications"
        description="Automated, branded messages with a complete delivery history."
        actions={<Button onClick={() => setSendModal(true)}><Send size={16} /> Send message</Button>}
      />
      <div className="communications-tabs" role="group" aria-label="Communication view">
        {([["activity", "Activity"], ["templates", "Templates"], ["reminders", "Reminder rules"]] as const).map(([id, label]) => (
          <button type="button" key={id} className={tab === id ? "active" : ""} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}{id === "activity" && <span className="tab-count">{state.communications.length}</span>}
          </button>
        ))}
      </div>
      {tab === "activity" && (
        <section className="panel data-panel">
          <div className="data-toolbar">
            <label className="table-search">
              <Search size={16} />
              <input aria-label="Search recipients or subjects" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search recipients or subjects" />
              {search && <button type="button" aria-label="Clear communication search" onClick={() => setSearch("")}><X size={14} /></button>}
            </label>
          </div>
          <div className="table-scroll">
            <table className="data-table comms-table">
              <thead><tr><th>Recipient</th><th>Subject</th><th>Template</th><th>Status</th><th>Sent</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} onClick={() => setLogId(log.id)}>
                    <td><div className="recipient-cell"><span>{log.recipient.slice(0, 2).toUpperCase()}</span><b>{log.recipient}</b></div></td>
                    <td><div className="submission-title-cell"><b>{log.subject}</b><span>{log.preview}</span></div></td>
                    <td><span className="track-chip">{log.template}</span></td>
                    <td><StatusBadge value={log.status} /></td>
                    <td><span className="table-date">{formatInZone(log.sentAt, eventZone(log.eventId), { month: "short", day: "numeric", timeZoneName: "short" })}<small>{formatInZone(log.sentAt, eventZone(log.eventId), { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</small></span></td>
                    <td>
                      <button type="button" className="icon-button" aria-label={`View communication to ${log.recipient}`} onClick={(event) => { event.stopPropagation(); setLogId(log.id); }}>
                        <MoreHorizontal size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {tab === "templates" && (
        <div className="template-grid">
          {templates.map((template) => (
            <article className="panel communication-template-card" key={template.key}>
              <header className="communication-template-card__header">
                <span className="template-icon"><Mail size={18} /></span>
                <StatusBadge value={template.enabled ? "Active" : "Paused"} />
              </header>
              <div className="communication-template-card__body">
                <h2>{template.name}</h2>
                <p>{template.trigger}</p>
                <div className="communication-template-subject"><small>Subject</small><b>{template.subject}</b></div>
              </div>
              <footer><span>Edited 2 days ago</span><Button size="sm" variant="secondary" onClick={() => setEditKey(template.key)}><Edit3 size={14} /> Edit</Button></footer>
            </article>
          ))}
        </div>
      )}
      {tab === "reminders" && <ReminderRules onSave={() => toast("Reminder ladder saved")} />}
      <Drawer open={Boolean(activeLog)} onClose={() => setLogId(null)} title="Communication detail">
        {activeLog && (
          <div className="comm-detail">
            <div className="comm-detail-status"><StatusBadge value={activeLog.status} /><span>Delivered by Resend · idempotent</span></div>
            <dl><div><dt>Recipient</dt><dd>{activeLog.recipient}</dd></div><div><dt>Template</dt><dd>{activeLog.template}</dd></div><div><dt>Sent</dt><dd>{formatInZone(activeLog.sentAt, eventZone(activeLog.eventId), "long")}</dd></div></dl>
            <section><span>SUBJECT</span><h2>{activeLog.subject}</h2><div className="rendered-email"><span className="public-event-logo">AI<span>.engineer</span></span><p>Hi there,</p><p>{activeLog.preview}</p><span className="button button-primary button-sm">Open your speaker portal</span><small>AI Engineer World’s Fair · September 15–16, 2026</small></div></section>
          </div>
        )}
      </Drawer>
      <TemplateEditor
        key={editKey ?? "closed"}
        template={activeTemplate ?? null}
        onClose={() => setEditKey(null)}
        onSave={(next) => { setTemplates((items) => items.map((item) => item.key === next.key ? next : item)); setEditKey(null); toast("Template sanitized and saved"); }}
      />
      <Modal
        open={sendModal}
        onClose={() => setSendModal(false)}
        title="Send a message"
        description="Messages are queued through the communications outbox."
        footer={<><Button variant="secondary" onClick={() => setSendModal(false)}>Cancel</Button><Button disabled={!sendTemplate || recipients.length === 0} onClick={sendMessage}>Queue message</Button></>}
      >
        <div className="form-stack">
          <Field label="Audience">
            <Select value={audience} onChange={(event) => setAudience(event.target.value as Audience)}>
              <option value="unconfirmed">Unconfirmed speakers</option>
              <option value="confirmed">Confirmed speakers</option>
              <option value="current">All current speakers</option>
            </Select>
          </Field>
          <Field label="Template">
            <Select value={sendTemplateKey} onChange={(event) => setSendTemplateKey(event.target.value)}>
              {templates.filter((template) => template.enabled).map((template) => <option key={template.key} value={template.key}>{template.name}</option>)}
            </Select>
          </Field>
          <div className="recipient-preview"><CheckCircle2 size={17} /><div><b>{recipients.length} unique {recipients.length === 1 ? "recipient" : "recipients"}</b><span>Suppression and current speaker state are rechecked at send time.</span></div></div>
        </div>
      </Modal>
    </div>
  );
}
function TemplateEditor({template,onClose,onSave}:{template:Template|null;onClose:()=>void;onSave:(template:Template)=>void}){const[subject,setSubject]=useState(template?.subject??"");const[body,setBody]=useState(template?.body??"");function insertVariable(value:string){setBody((current)=>current+value)}if(!template)return null;return <Modal open={Boolean(template)} onClose={onClose} title={`Edit ${template.name}`} description="Use only variables shown below; HTML is sanitized on save." wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={()=>onSave({...template,subject,body:sanitize(body)})}>Save template</Button></>}><div className="template-editor"><div className="form-stack"><Field label="Subject"><input value={subject} onChange={(e)=>setSubject(e.target.value)}/></Field><Field label="Email body" hint="Allowed variables: {{contact.first_name}}, {{event.name}}, {{submission.title}}, {{portal.url}}"><textarea value={body} onChange={(e)=>setBody(e.target.value)}/></Field><div className="template-vars"><button type="button" onClick={()=>insertVariable("{{contact.first_name}}")}>{"{{contact.first_name}}"}</button><button type="button" onClick={()=>insertVariable("{{event.name}}")}>{"{{event.name}}"}</button><button type="button" onClick={()=>insertVariable("{{portal.url}}")}>{"{{portal.url}}"}</button></div></div><aside><span>PREVIEW</span><div><b>{subject}</b><RichTextView html={body}/><span className="button button-primary button-sm">Open speaker portal</span></div></aside></div></Modal>}
function ReminderRules({ onSave }: { onSave: () => void }) {
  const rules = [{ label: "7 days before", tone: "accent" }, { label: "1 day before", tone: "amber" }, { label: "When overdue", tone: "red" }];
  const [enabled, setEnabled] = useState(true);
  const [ruleEnabled, setRuleEnabled] = useState(() => rules.map(() => true));
  return <div className="reminder-layout"><section className="panel reminder-rules reminder-rules-demo"><header className="panel-header"><div><h2>Task reminder ladder</h2><p>Only the latest eligible rung sends in each scan.</p></div><Switch label="Enable reminder ladder" checked={enabled} onClick={() => setEnabled((value) => !value)} /></header><div className="reminder-ladder">{rules.map((rule,index)=><div className={`reminder-rule reminder-rule-demo ${!enabled ? "is-disabled" : ""}`} key={rule.label}><span className={`rule-step ${rule.tone}`}>{index+1}</span><div className="reminder-rule-copy"><b>{rule.label}</b><small>Send “Task reminder” to open assignments</small></div><Switch label={`Enable ${rule.label} reminder`} checked={ruleEnabled[index] ?? false} disabled={!enabled} onClick={() => setRuleEnabled((current) => current.map((value, position) => position === index ? !value : value))} /></div>)}</div><footer><Button onClick={onSave}>Save reminder rules</Button></footer></section><aside className="panel reminder-explainer"><span><Clock3 size={21}/></span><h3>Burst-safe by design</h3><p>If a scheduled scan is delayed, Openboard sends only the most recent eligible reminder—not every missed rung.</p><ul><li>Rechecks completion before send</li><li>One idempotency key per rung</li><li>Retires obsolete queued reminders</li></ul></aside></div>;
}
