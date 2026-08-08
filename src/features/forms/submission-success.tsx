"use client";

import Link from "next/link";
import { ArrowRight, Check, Clock3, Mail, PencilLine } from "lucide-react";
import { useDemo } from "@/shared/demo/demo-provider";
import { Brand } from "@/shared/ui/brand";

export function SubmissionSuccess({ eventSlug, formId, code }: { eventSlug: string; formId: string; code: string }) {
  const { state } = useDemo(); const form = state.forms.find((item)=>item.id===formId); const submission = state.submissions.find((item)=>item.code===code);
  return <main className="success-page"><header><span className="public-event-logo">AI<span>.engineer</span></span><Brand dark /></header><section><div className="success-check"><Check size={34}/></div><span className="public-eyebrow">PROPOSAL RECEIVED · {code}</span><h1>{form?.successTitle ?? "Your idea is in!"}</h1><p>{form?.successBody}</p><div className="success-summary"><small>YOUR PROPOSAL</small><b>{submission?.title ?? "Your submitted session"}</b><span>{submission?.track ?? "AI Engineer World’s Fair 2026"}</span></div><div className="next-steps"><h2>What happens next?</h2><div><span><Mail size={19}/></span><p><b>Check your inbox</b>We sent a confirmation and a link to your speaker portal.</p></div><div><span><PencilLine size={19}/></span><p><b>Edit until August 31</b>You can update your proposal any time before the call closes.</p></div><div><span><Clock3 size={19}/></span><p><b>Decisions by September 3</b>Our review committee will email you as soon as decisions are ready.</p></div></div><Link className="button button-primary button-lg" href={`/portal/${eventSlug}`}>Open speaker portal <ArrowRight size={17}/></Link><Link className="success-secondary" href={`/submit/${eventSlug}/${formId}`}>Submit another proposal</Link></section></main>;
}
