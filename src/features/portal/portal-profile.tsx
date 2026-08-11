"use client";

import { Camera, CheckCircle2, Linkedin, LinkIcon, MapPin, UserRound } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { useDemo } from "@/shared/demo/demo-provider";
import { usePortal } from "./portal-context";
import { Avatar, Button, Field, ProgressBar } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

// Keyed by speaker id so the draft state re-initializes when the portal
// session identity changes (e.g. impersonation resolving after first render).
export function PortalProfile() {
  const { speaker } = usePortal();
  return <ProfileForm key={speaker.id} />;
}

function ProfileForm() {
  const { dispatch } = useDemo();
  const { event, speaker } = usePortal();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [bio, setBio] = useState(speaker.bio);
  const [company, setCompany] = useState(speaker.company);
  const [title, setTitle] = useState(speaker.title);
  const [location, setLocation] = useState(speaker.location);
  const [website, setWebsite] = useState(speaker.website);
  const [linkedin, setLinkedin] = useState(speaker.linkedin);
  const speakerId = speaker.id;
  function choosePhoto(file: File | undefined) {
    if (!file) return;
    if (!new Set(["image/jpeg", "image/png"]).has(file.type)) {
      toast("Choose a JPG or PNG image");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast("That photo is larger than 5 MB");
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") setPhotoUrl(reader.result);
    });
    reader.readAsDataURL(file);
    toast("Photo preview updated");
  }
  function save() {
    dispatch({ type: "UPDATE_SPEAKER", speakerId, patch: { bio, company, title, location, website, linkedin, profileCompletion: 100 } });
    toast("Profile saved and public gallery updated");
  }
  return <div className="portal-container portal-page">
    <header className="portal-page-header"><span className="public-eyebrow">YOUR PUBLIC PROFILE</span><h1>Speaker profile</h1><p>This information appears on the public speaker gallery.</p></header>
    <div className="profile-edit-layout"><main><section className="portal-panel profile-photo-section"><div className="profile-photo"><Avatar initials={speaker.avatar} color={speaker.avatarColor} imageUrl={photoUrl || undefined} size="xl" /><button type="button" aria-label="Change photo" onClick={() => fileRef.current?.click()}><Camera size={16} /></button></div><div><h2>Profile photo</h2><p>A square image works best. JPG or PNG, up to 5 MB.</p><Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>Upload new photo</Button><input ref={fileRef} type="file" accept="image/jpeg,image/png" hidden onChange={(event) => choosePhoto(event.target.files?.[0])} /></div></section><section className="portal-panel profile-form"><h2>About you</h2><div className="form-grid"><Field label="First name"><input value={speaker.firstName} readOnly /></Field><Field label="Last name"><input value={speaker.lastName} readOnly /></Field><Field label="Company"><input value={company} onChange={(event) => setCompany(event.target.value)} /></Field><Field label="Job title"><input value={title} onChange={(event) => setTitle(event.target.value)} /></Field></div><Field label="Biography" hint={`${bio.length} / 5,000 characters`}><textarea value={bio} maxLength={5000} onChange={(event) => setBio(event.target.value)} /></Field><h2>Links & location</h2><div className="form-stack"><Field label="Location"><div className="input-icon"><MapPin size={16} /><input value={location} onChange={(event) => setLocation(event.target.value)} /></div></Field><Field label="Website"><div className="input-icon"><LinkIcon size={16} /><input value={website} onChange={(event) => setWebsite(event.target.value)} /></div></Field><Field label="LinkedIn"><div className="input-icon"><Linkedin size={16} /><input value={linkedin} onChange={(event) => setLinkedin(event.target.value)} /></div></Field></div><footer><Button onClick={save}>Save profile</Button></footer></section></main><aside><section className="portal-panel profile-readiness"><span className="metric-icon green"><CheckCircle2 size={20} /></span><h3>Your profile is ready</h3><p>Complete profiles help attendees discover your work before the event.</p><div><span>Completion</span><b>{speaker.profileCompletion}%</b></div><ProgressBar value={speaker.profileCompletion} tone="green" /></section><section className="portal-panel public-preview"><span>PUBLIC PREVIEW</span><Avatar initials={speaker.avatar} color={speaker.avatarColor} imageUrl={photoUrl || undefined} size="xl" /><h3>{speaker.firstName} {speaker.lastName}</h3><p>{title} · {company}</p><small>{bio.slice(0, 140)}…</small><Link href={"/e/" + event.slug + "/speakers"}><UserRound size={14} /> View gallery profile</Link></section></aside></div>
  </div>;
}
