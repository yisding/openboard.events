"use client";

import { Clock3, Edit3, FileText, Lock, MapPin } from "lucide-react";
import { useState } from "react";
import { useDemo } from "@/shared/demo/demo-provider";
import { usePortal } from "./portal-context";
import { formatInZone } from "@/shared/lib/time";
import type { FormRecord, SubmissionRecord } from "@/shared/demo/types";
import { Button, Field, Modal, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

// Speakers may edit until the owning form closes, and never after a decision.
function isEditable(submission: SubmissionRecord, form: FormRecord | undefined) {
  if (!form) return false;
  if (["accepted", "declined", "withdrawn"].includes(submission.status)) return false;
  if (form.status !== "open") return false;
  if (form.opensAt && Date.now() < Date.parse(form.opensAt)) return false;
  if (form.closesAt && Date.now() > Date.parse(form.closesAt)) return false;
  return true;
}

export function PortalSubmissions(){const{state,dispatch}=useDemo();const{event,speaker}=usePortal();const{toast}=useToast();const[editId,setEditId]=useState<string|null>(null);const submissions=state.submissions.filter((item)=>item.eventId===event.id&&item.speakerIds.includes(speaker.id));const active=submissions.find((item)=>item.id===editId);const[title,setTitle]=useState("");const[abstract,setAbstract]=useState("");const activeForm=state.forms.find((form)=>form.id===active?.formId);function open(id:string){const item=submissions.find((submission)=>submission.id===id);setEditId(id);setTitle(item?.title??"");setAbstract(item?.abstract??"")}function save(){if(active&&isEditable(active,activeForm)){dispatch({type:"UPDATE_SUBMISSION",submissionId:active.id,patch:{title,abstract,updatedAt:new Date().toISOString()}});toast("Proposal updated")}else if(active){toast("This proposal is no longer editable")}setEditId(null)}return <div className="portal-container portal-page"><header className="portal-page-header"><span className="public-eyebrow">MY PROGRAM</span><h1>My submissions</h1><p>Review your proposals and scheduled sessions.</p></header><div className="portal-submission-grid">{submissions.map((submission)=>{const session=state.sessions.find((item)=>item.submissionId===submission.id);const form=state.forms.find((item)=>item.id===submission.formId);const editable=isEditable(submission,form);return <article className="portal-submission" key={submission.id}><header><span className="portal-doc-icon"><FileText size={21}/></span><div><span>{submission.code}</span><StatusBadge value={submission.status}/></div></header><h2>{submission.title}</h2><p>{submission.abstract}</p><div className="portal-tags"><span>{submission.track}</span><span>{submission.format}</span></div>{session?.startsAt&&<div className="portal-scheduled"><b>Your session is scheduled</b><span><Clock3 size={14}/>{formatInZone(session.startsAt,event.timezone,{month:"long",day:"numeric",hour:"numeric",minute:"2-digit"})}</span><span><MapPin size={14}/>{session.room}</span></div>}<footer><span>Updated {formatInZone(submission.updatedAt,event.timezone,{month:"long",day:"numeric"})}</span>{editable?<Button size="sm" variant="secondary" onClick={()=>open(submission.id)}><Edit3 size={14}/> Edit proposal</Button>:<span className="locked-note"><Lock size={13}/> {["accepted","declined","withdrawn"].includes(submission.status)?"Locked after decision":"Editing closed"}</span>}</footer></article>})}</div><Modal open={Boolean(active)} onClose={()=>setEditId(null)} title="Edit your proposal" description="Changes are allowed until the call closes." footer={<><Button variant="secondary" onClick={()=>setEditId(null)}>Cancel</Button><Button onClick={save}>Save changes</Button></>}><div className="form-stack"><Field label="Session title"><input value={title} onChange={(e)=>setTitle(e.target.value)}/></Field><Field label="Abstract"><textarea value={abstract} onChange={(e)=>setAbstract(e.target.value)}/></Field><div className="setting-note"><Clock3 size={18}/><div><b>Editing closes {activeForm?.closesAt?formatInZone(activeForm.closesAt,event.timezone,{month:"long",day:"numeric",hour:"numeric",minute:"2-digit"}):"when the call closes"}</b><p>After the deadline, contact the organizing team for changes.</p></div></div></div></Modal></div>}
