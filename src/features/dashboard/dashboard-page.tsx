"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight, CalendarCheck, CheckCircle2, Clock3, FileText, Sparkles, TrendingUp, UserCheck, Users } from "lucide-react";
import { useDemo, speakerName } from "@/shared/demo/demo-provider";
import { Avatar, PageHeader, ProgressBar, StatusBadge } from "@/shared/ui/ui-kit";

export function DashboardPage({ eventId }: { eventId: string }) {
  const { state } = useDemo();
  const event = state.events.find((item) => item.id === eventId);
  const accepted = state.submissions.filter((item) => item.status === "accepted");
  const confirmed = state.speakers.filter((item) => item.confirmation === "confirmed");
  const scheduled = state.sessions.filter((item) => item.startsAt);
  const totalAssigned = state.tasks.reduce((sum, task) => sum + task.assigned, 0);
  const totalComplete = state.tasks.reduce((sum, task) => sum + task.completed, 0);
  const completion = totalAssigned === 0 ? 0 : Math.round((totalComplete / totalAssigned) * 100);
  if (!event) return null;
  const attention = state.speakers.map((speaker) => ({ speaker, remaining: state.tasks.filter((task) => !state.completions.some((done) => done.taskId === task.id && done.speakerId === speaker.id)).length })).sort((a, b) => b.remaining - a.remaining).slice(0, 5);

  return <div className="dashboard-page"><PageHeader eyebrow="SATURDAY, AUGUST 8" title="Good morning, Maya" description={`Here’s what needs your attention for ${event?.name ?? "your event"}.`} actions={<><Link className="button button-secondary" href={`/e/${event?.slug ?? "ai-engineer"}/schedule`} target="_blank">View live site <ArrowRight size={16} /></Link><Link className="button button-primary" href={`/events/${event?.id ?? ""}/forms`}>Create <span className="button-plus">＋</span></Link></>} />

    <div className="attention-banner"><span className="attention-spark"><Sparkles size={20} /></span><div><b>18 speakers need a nudge</b><p>Most are waiting on profiles or final slides. Send a reminder before Monday.</p></div><Link href={`/events/${event?.id ?? ""}/communications`}>Review & send <ArrowRight size={16} /></Link></div>

    <section className="metric-grid">
      <article className="metric-card"><header><span className="metric-icon accent"><FileText size={20} /></span><span className="metric-trend up"><TrendingUp size={14} /> 18%</span></header><strong>247</strong><p>Total submissions</p><footer><span>12 new this week</span><Link href={`/events/${event?.id ?? ""}/abstracts`}>View all</Link></footer></article>
      <article className="metric-card"><header><span className="metric-icon green"><UserCheck size={20} /></span><span className="metric-label">33% acceptance</span></header><strong>{accepted.length + 74}</strong><p>Accepted speakers</p><footer><span>{confirmed.length + 68} confirmed</span><Link href={`/events/${event?.id ?? ""}/speakers`}>Manage</Link></footer></article>
      <article className="metric-card"><header><span className="metric-icon"><CheckCircle2 size={20} /></span><span className="metric-label">Across 4 tasks</span></header><strong>{completion}%</strong><p>Onboarding complete</p><ProgressBar label="Onboarding completion" value={completion} tone="amber" /><footer><span>{totalAssigned - totalComplete} items remaining</span><Link href={`/events/${event?.id ?? ""}/tasks`}>Track</Link></footer></article>
      <article className="metric-card"><header><span className="metric-icon"><CalendarCheck size={20} /></span><span className="metric-label">2 days</span></header><strong>{scheduled.length + 24}</strong><p>Sessions scheduled</p><footer><span>4 still unscheduled</span><Link href={`/events/${event?.id ?? ""}/agenda`}>Open agenda</Link></footer></article>
    </section>

    <section className="dashboard-grid">
      <article className="panel submissions-chart-panel"><header className="panel-header"><div><h2>Submission momentum</h2><p>Applications received over the last eight weeks</p></div><select defaultValue="8" aria-label="Submission chart range"><option value="8">Last 8 weeks</option><option value="4">Last 4 weeks</option></select></header><div className="chart-summary"><strong>247</strong><span><TrendingUp size={14} /> +38 this week</span></div><div className="area-chart"><div className="chart-y"><span>60</span><span>40</span><span>20</span><span>0</span></div><div className="chart-plot"><i /><i /><i /><svg viewBox="0 0 700 180" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00a878" stopOpacity=".25"/><stop offset="100%" stopColor="#00a878" stopOpacity="0"/></linearGradient></defs><path className="area" d="M0,165 C60,152 70,140 120,143 C185,146 190,113 248,119 C305,125 320,86 375,91 C430,97 443,57 500,67 C550,75 590,38 700,20 L700,180 L0,180Z"/><path className="line" d="M0,165 C60,152 70,140 120,143 C185,146 190,113 248,119 C305,125 320,86 375,91 C430,97 443,57 500,67 C550,75 590,38 700,20"/><g>{[[0,165],[120,143],[248,119],[375,91],[500,67],[700,20]].map(([x,y]) => <circle key={x} cx={x} cy={y} r="4" />)}</g></svg><div className="chart-x"><span>Jun 15</span><span>Jun 29</span><span>Jul 13</span><span>Jul 27</span><span>Aug 8</span></div></div></div></article>

      <article className="panel deadline-panel"><header className="panel-header"><div><h2>Event countdown</h2><p>AI Engineer World’s Fair</p></div><span className="tiny-chip">38 days</span></header><div className="countdown"><div><strong>38</strong><small>days</small></div><i>:</i><div><strong>07</strong><small>hours</small></div><i>:</i><div><strong>24</strong><small>min</small></div></div><div className="milestone-list"><div className="done"><span><CheckCircle2 size={16} /></span><div><b>Call for speakers opens</b><small>May 1</small></div></div><div className="current"><span><Clock3 size={16} /></span><div><b>Call for speakers closes</b><small>August 31 · 23 days</small></div></div><div><span><CalendarCheck size={16} /></span><div><b>Final slides due</b><small>September 10</small></div></div><div><span><Sparkles size={16} /></span><div><b>Event begins</b><small>September 15</small></div></div></div></article>

      <article className="panel speaker-attention"><header className="panel-header"><div><h2>Speakers needing attention</h2><p>Ranked by outstanding onboarding items</p></div><Link href={`/events/${event?.id ?? ""}/speakers`}>View all <ArrowRight size={15} /></Link></header><div className="attention-list">{attention.map(({ speaker, remaining }) => <div key={speaker.id}><Avatar initials={speaker.avatar} color={speaker.avatarColor} /><div className="attention-person"><b>{speakerName(speaker)}</b><span>{speaker.company}</span></div><div className="attention-progress"><span>{speaker.profileCompletion}% profile</span><ProgressBar label={`Profile completion for ${speakerName(speaker)}`} value={speaker.profileCompletion} /></div><StatusBadge value={`${remaining} ${remaining === 1 ? "task" : "tasks"}`} /></div>)}</div></article>

      <article className="panel quick-actions"><header className="panel-header"><div><h2>Quick actions</h2><p>Keep your program moving</p></div></header><div className="quick-grid"><Link href={`/events/${event?.id ?? ""}/communications`}><span className="metric-icon accent"><MailIcon /></span><b>Send update</b><small>Email your speakers</small><ArrowRight size={16} /></Link><Link href={`/events/${event?.id ?? ""}/agenda`}><span className="metric-icon"><CalendarCheck size={18} /></span><b>Schedule session</b><small>Place an accepted talk</small><ArrowRight size={16} /></Link><Link href={`/events/${event?.id ?? ""}/abstracts`}><span className="metric-icon"><ClipboardIcon /></span><b>Review abstracts</b><small>12 waiting for a decision</small><ArrowRight size={16} /></Link><Link href={`/events/${event?.id ?? ""}/speakers`}><span className="metric-icon"><Users size={18} /></span><b>Add speaker</b><small>Create a new profile</small><ArrowRight size={16} /></Link></div></article>
    </section>
    <div className="dashboard-footer-note"><AlertCircle size={15} /> Demo data is saved in this browser. You can reset it from the events page.</div>
  </div>;
}

function MailIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>; }
function ClipboardIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 14h6"/></svg>; }
