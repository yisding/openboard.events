import{defineJobRoute}from"../_lib";export const dynamic="force-dynamic";export const POST=defineJobRoute("outbox",async()=>({claimed:0,sent:0,failed:0}));
