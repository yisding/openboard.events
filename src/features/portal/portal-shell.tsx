"use client";

import Link from "next/link";
import { Bell, BookOpen, CalendarDays, ChevronDown, ClipboardCheck, Home, Menu, UserRound, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useDemo } from "@/shared/demo/demo-provider";
import { DEMO_SPEAKER_ID } from "@/shared/demo/seed";
import { Avatar } from "@/shared/ui/ui-kit";

const links=[{label:"Home",href:"",icon:Home},{label:"My submissions",href:"submissions",icon:CalendarDays},{label:"Tasks",href:"tasks",icon:ClipboardCheck},{label:"Profile",href:"profile",icon:UserRound},{label:"Resources",href:"resources",icon:BookOpen}];
export function PortalShell({children}:{children:React.ReactNode}){const pathname=usePathname();const{state}=useDemo();const[open,setOpen]=useState(false);const event=state.events[0];const speaker=state.speakers.find((item)=>item.id===DEMO_SPEAKER_ID)??state.speakers[0];const base=`/portal/${event?.slug??"ai-engineer"}`;return <div className="portal-shell"><header className="portal-header"><div className="portal-container"><button className="portal-mobile-menu" onClick={()=>setOpen(!open)}>{open?<X size={20}/>:<Menu size={20}/>}</button><Link href={base} className="portal-event-brand"><span className="public-event-logo">AI<span>.engineer</span></span><i/><small>Speaker Portal</small></Link><nav className={open?"open":""}>{links.map((item)=>{const Icon=item.icon;const href=item.href?`${base}/${item.href}`:base;const active=item.href?pathname.includes(`/${item.href}`):pathname===base;return <Link key={item.label} href={href} className={active?"active":""} onClick={()=>setOpen(false)}><Icon size={16}/>{item.label}{item.href==="tasks"&&<span>1</span>}</Link>})}</nav><div className="portal-account"><button className="icon-button notification-button"><Bell size={18}/><i/></button><Avatar initials={speaker?.avatar??"?"} color={speaker?.avatarColor}/><span><b>{speaker?.firstName}</b><small>Speaker</small></span><ChevronDown size={15}/></div></div></header><main className="portal-main">{children}</main><footer className="portal-site-footer"><div className="portal-container"><span>AI Engineer World’s Fair 2026</span><div><a href="mailto:speakers@ai.engineer">Get help</a><Link href={`/e/${event?.slug??"ai-engineer"}/schedule`}>Public schedule</Link><span>Powered by Openboard</span></div></div></footer></div>}
