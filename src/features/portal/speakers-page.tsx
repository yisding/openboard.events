"use client";

import { ChevronDown, ExternalLink, Filter, Mail, MoreHorizontal, Plus, Search, UserCheck, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useDemo, speakerName } from "@/shared/demo/demo-provider";
import { PORTAL_SPEAKER_KEY } from "./portal-context";
import type { SpeakerRecord } from "@/shared/demo/types";
import { Avatar, Button, Drawer, PageHeader, ProgressBar, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

export function SpeakersPage({ eventId }: { eventId: string }) {
  const { state, dispatch } = useDemo();
  const { toast } = useToast();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [confirmation, setConfirmation] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const event = state.events.find((item) => item.id === eventId);
  const eventSpeakers = useMemo(() => state.speakers.filter((speaker) => speaker.eventId === eventId), [state.speakers, eventId]);
  const speakers = useMemo(() => eventSpeakers.filter((speaker) => (confirmation === "all" || speaker.confirmation === confirmation) && `${speakerName(speaker)} ${speaker.company} ${speaker.email}`.toLowerCase().includes(search.toLowerCase())), [confirmation, search, eventSpeakers]);
  const active = eventSpeakers.find((item) => item.id === openId) ?? null;
  const outstanding = (speakerId: string) => state.tasks.filter((task) => task.eventId === eventId && !state.completions.some((done) => done.taskId === task.id && done.speakerId === speakerId)).length;
  // Demo impersonation: store the speaker id the portal session should assume,
  // then open the portal. The portal shows an organizer-preview banner.
  function openPortalAs(speaker: SpeakerRecord) {
    window.localStorage.setItem(PORTAL_SPEAKER_KEY, speaker.id);
    router.push(`/portal/${event?.slug ?? "ai-engineer"}`);
  }
  return <>
    <PageHeader eyebrow="PEOPLE" title="Speakers" description="Track confirmation, profiles, and onboarding from one place." actions={<><Button variant="secondary" onClick={() => toast("Reminder queued for 6 speakers")}><Mail size={16} /> Send reminder</Button><Button onClick={() => toast("Speaker invite link copied")}><Plus size={16} /> Add speaker</Button></>} />
    <section className="summary-row"><article><span className="summary-icon purple"><Users size={19} /></span><div><strong>{eventSpeakers.length + 70}</strong><small>Accepted speakers</small></div></article><article><span className="summary-icon green"><UserCheck size={19} /></span><div><strong>{eventSpeakers.filter((speaker) => speaker.confirmation === "confirmed").length + 68}</strong><small>Confirmed</small></div></article><article><span className="summary-icon amber"><span>!</span></span><div><strong>18</strong><small>Need attention</small></div></article><article><span className="summary-icon blue"><span>✓</span></span><div><strong>91%</strong><small>Average readiness</small></div></article></section>
    <section className="panel data-panel"><div className="data-toolbar"><label className="table-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search speakers" />{search && <button onClick={() => setSearch("")}><X size={14} /></button>}</label><button className="filter-button"><Filter size={15} /> Track <ChevronDown size={14} /></button><select className="compact-select" value={confirmation} onChange={(event) => setConfirmation(event.target.value)}><option value="all">All confirmations</option><option value="confirmed">Confirmed</option><option value="unconfirmed">Unconfirmed</option><option value="declined">Declined</option></select><span className="row-count">{speakers.length} shown</span></div>
      <div className="table-scroll"><table className="data-table speakers-table"><thead><tr><th><input type="checkbox" /></th><th>Speaker</th><th>Confirmation</th><th>Profile</th><th>Outstanding</th><th>Sessions</th><th /></tr></thead><tbody>{speakers.map((speaker) => {
        const remaining = outstanding(speaker.id);
        const sessions = state.submissions.filter((item) => item.speakerIds.includes(speaker.id) && item.status === "accepted");
        return <tr key={speaker.id} onClick={() => setOpenId(speaker.id)}><td onClick={(event) => event.stopPropagation()}><input type="checkbox" /></td><td><div className="speaker-table-person"><Avatar initials={speaker.avatar} color={speaker.avatarColor} /><div><b>{speakerName(speaker)}</b><span>{speaker.title} · {speaker.company}</span><small>{speaker.email}</small></div></div></td><td><StatusBadge value={speaker.confirmation} /></td><td><div className="profile-cell"><span>{speaker.profileCompletion}%</span><ProgressBar value={speaker.profileCompletion} tone={speaker.profileCompletion === 100 ? "green" : "purple"} /></div></td><td>{remaining ? <StatusBadge value={`${remaining} tasks`} /> : <StatusBadge value="Ready" />}</td><td><span className="session-count">{sessions.length}</span></td><td><button className="icon-button"><MoreHorizontal size={17} /></button></td></tr>;
      })}</tbody></table></div><div className="table-footer"><span>Showing {speakers.length} of 82 speakers</span><div><button disabled>Previous</button><button className="active">1</button><button>2</button><button>Next</button></div></div>
    </section>
    <SpeakerDrawer speaker={active} onClose={() => setOpenId(null)} onOpenPortal={openPortalAs} onConfirmation={(value) => { if (active) dispatch({ type: "UPDATE_SPEAKER", speakerId: active.id, patch: { confirmation: value } }); toast("Confirmation updated"); }} />
  </>;
}

function SpeakerDrawer({ speaker, onClose, onOpenPortal, onConfirmation }: { speaker: SpeakerRecord | null; onClose: () => void; onOpenPortal: (speaker: SpeakerRecord) => void; onConfirmation: (value: SpeakerRecord["confirmation"]) => void }) {
  const { state } = useDemo();
  if (!speaker) return null;
  const submissions = state.submissions.filter((item) => item.speakerIds.includes(speaker.id));
  const sessions = state.sessions.filter((item) => item.speakerIds.includes(speaker.id));
  return <Drawer open={Boolean(speaker)} onClose={onClose} title="Speaker profile"><div className="speaker-drawer"><div className="speaker-drawer-hero"><Avatar initials={speaker.avatar} color={speaker.avatarColor} size="xl" /><h2>{speakerName(speaker)}</h2><p>{speaker.title} at {speaker.company}</p><span>{speaker.location}</span><div><Button onClick={() => onOpenPortal(speaker)}><ExternalLink size={15} /> Open portal as {speaker.firstName}</Button><button type="button" className="button button-secondary"><Mail size={15} /> Email</button></div></div><div className="profile-overview"><div><span>Profile readiness</span><b>{speaker.profileCompletion}%</b></div><ProgressBar value={speaker.profileCompletion} /></div><section className="drawer-content"><h3>Confirmation</h3><div className="confirmation-options">{(["unconfirmed", "confirmed", "declined"] as const).map((value) => <button key={value} onClick={() => onConfirmation(value)} className={speaker.confirmation === value ? "active" : ""}>{value}</button>)}</div><h3>Biography</h3><p className="long-copy">{speaker.bio || "No biography submitted yet."}</p><h3>Sessions</h3>{submissions.map((submission) => <div className="mini-session" key={submission.id}><span>{submission.code}</span><b>{submission.title}</b><StatusBadge value={submission.status} /></div>)}<h3>Scheduled times</h3>{sessions.length ? sessions.map((session) => <div className="mini-session" key={session.id}><span>{session.startsAt ? new Date(session.startsAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Unscheduled"}</span><b>{session.title}</b><small>{session.room}</small></div>) : <p className="long-copy">No scheduled session yet.</p>}</section></div></Drawer>;
}
