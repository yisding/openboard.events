import{defineJobRoute}from"../_lib";export const dynamic="force-dynamic";export const POST=defineJobRoute("reminders",async()=>({scanned:0,queued:0,retired:0}));
