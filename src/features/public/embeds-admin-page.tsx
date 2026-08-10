"use client";

import { Check, Clipboard, ExternalLink, MonitorSmartphone, Palette } from "lucide-react";
import { useEffect, useState } from "react";
import { useDemo } from "@/shared/demo/demo-provider";
import { Button, PageHeader, Segmented } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

// Scoped per event so one event's appearance never leaks into another's.
export const EMBED_SETTINGS_KEY = "openboard-embed-settings";
const settingsKey = (eventId: string) => `${EMBED_SETTINGS_KEY}:${eventId}`;

type EmbedSettings = { theme: "light" | "dark"; header: boolean; enabled: boolean; accent: string };
const DEFAULTS: EmbedSettings = { theme: "light", header: true, enabled: true, accent: "#00A878" };

export function EmbedsAdminPage({eventId}:{eventId:string}){const{state}=useDemo();const{toast}=useToast();const[settings,setSettings]=useState<EmbedSettings>(DEFAULTS);const[origin,setOrigin]=useState("");const event=state.events.find((item)=>item.id===eventId);const slug=event?.slug??"ai-engineer";
useEffect(()=>{setOrigin(window.location.origin);try{const saved=window.localStorage.getItem(settingsKey(eventId));if(saved)setSettings({...DEFAULTS,...JSON.parse(saved) as Partial<EmbedSettings>})}catch{/* keep defaults */}},[eventId]);
function saveSettings(){window.localStorage.setItem(settingsKey(eventId),JSON.stringify(settings));toast("Embed settings saved — snippets updated")}
const query=`theme=${settings.theme}&header=${settings.header?1:0}&accent=${encodeURIComponent(settings.accent)}`;
const iframeSnippet=(type:string)=>`<iframe src="${origin}/embed/${slug}/${type}?${query}" width="100%" height="760" style="border:0" loading="lazy" title="${slug} ${type}"></iframe>`;
const scriptSnippet=(type:string)=>`<script src="${origin}/embed.js" data-event="${slug}" data-type="${type}" data-params="${query}" async></script>`;
function copy(type:string){void navigator.clipboard.writeText(iframeSnippet(type));toast(`${type} embed code copied`)}
return <><PageHeader eyebrow="ENGAGE" title="Embeds" description="Put your live schedule and speaker gallery on any website." actions={<Button variant="secondary" onClick={saveSettings}><Check size={16}/> Save settings</Button>}/><div className="embed-admin-grid"><section className="panel embed-config"><header className="panel-header"><div><h2>Appearance</h2><p>Shared across both embed types</p></div></header><div className="form-stack"><label className="field"><span>Color theme</span><Segmented value={settings.theme} onChange={(theme)=>setSettings({...settings,theme})} items={[{value:"light",label:"Light"},{value:"dark",label:"Dark"}]}/></label><label className="field"><span>Accent color</span><div className="color-input"><i style={{background:settings.accent}}/><input value={settings.accent} onChange={(e)=>setSettings({...settings,accent:e.target.value})}/></div></label><div className="inline-setting"><div><b>Show event header</b><small>Include event name and dates above content</small></div><button type="button" className={`switch ${settings.header?"on":""}`} onClick={()=>setSettings({...settings,header:!settings.header})}><i/></button></div><div className="inline-setting"><div><b>Embeds enabled</b><small>Turn off to hide both surfaces</small></div><button type="button" className={`switch ${settings.enabled?"on":""}`} onClick={()=>setSettings({...settings,enabled:!settings.enabled})}><i/></button></div></div></section><section className="embed-cards">{["schedule","speakers"].map((type)=><article className="panel" key={type}><span className="summary-icon accent">{type==="schedule"?<MonitorSmartphone size={20}/>:<Palette size={20}/>}</span><div><h2>{type==="schedule"?"Schedule itinerary":"Speaker gallery"}</h2><p>{type==="schedule"?"Mobile-friendly agenda with live filters and calendar links.":"Responsive confirmed-speaker cards with session links."}</p></div><a href={`/embed/${slug}/${type}?${query}`} target="_blank">View embed <ExternalLink size={14}/></a><div className="embed-code"><code>{`<iframe src="${origin||"…"}/embed/${slug}/${type}?…" …>`}</code><button type="button" aria-label="Copy embed code" onClick={()=>copy(type)}><Clipboard size={15}/></button></div><footer><Button variant="secondary" onClick={()=>copy(type)}><Clipboard size={15}/> Copy iframe</Button><Button variant="ghost" onClick={()=>{void navigator.clipboard.writeText(scriptSnippet(type));toast("Auto-resize script copied")}}>Copy auto-resize script</Button></footer></article>)}</section></div></>}
