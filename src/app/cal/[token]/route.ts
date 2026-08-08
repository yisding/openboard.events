import { initialDemoState } from "@/shared/demo/seed";
import { buildFeed } from "@/features/comms/ics";

export const dynamic="force-dynamic";
export async function GET(){const speaker=initialDemoState.speakers[0];const sessions=initialDemoState.sessions.filter((item)=>item.speakerIds.includes(speaker?.id??"")&&item.startsAt&&item.endsAt);const body=buildFeed("My AI Engineer sessions",sessions.map((session)=>({uid:`${session.id}@openboard`,sequence:1,startsAt:session.startsAt??"",endsAt:session.endsAt??"",summary:session.title,description:session.description,location:session.room})));return new Response(body,{headers:{"content-type":"text/calendar; charset=utf-8","content-disposition":"inline; filename=ai-engineer-sessions.ics","cache-control":"private, no-store"}})}
