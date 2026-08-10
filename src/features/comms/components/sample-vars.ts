import { TEMPLATE_VAR_SCHEMAS, type TemplateKey, type TemplateVars } from "@/shared/contracts";
import { z } from "zod";

/**
 * Fixture context for the live preview panel (step 3) — every field
 * `TEMPLATE_VAR_SCHEMAS[key]` requires, filled with a plausible value so
 * `renderTemplateContent` never throws `TEMPLATE_VAR_MISSING` on a fresh page
 * load.
 */
const common = {
  event: { name: "AI Engineer World's Fair", start_date: "September 15, 2026", location: "Fort Mason, San Francisco", timezone: "America/Los_Angeles" },
  speaker: { first_name: "Nadia", last_name: "Lee", email: "nadia@example.com" },
  portal: { magic_link: "https://openboard.events/portal/ai-engineer/verify?token=sample" },
  unsubscribe: { url: "https://openboard.events/portal/ai-engineer/unsubscribe?token=sample" },
};

const submission = { title: "Scaling agentic workflows in production", code: "SESS-142" };
const task = { name: "Upload your headshot", due_date: "September 1, 2026" };
const tasks = { outstanding_list: "<ul><li>Upload your headshot — September 1, 2026</li></ul>" };
const session = {
  title: "Scaling agentic workflows in production",
  start_time_local: "10:00 AM",
  end_time_local: "10:40 AM",
  timezone: "America/Los_Angeles",
  room: "Bayview",
  track: "AI Agents",
};
const calendar = {
  google_url: "https://calendar.google.com/calendar/render?action=TEMPLATE",
  outlook_url: "https://outlook.live.com/calendar/0/deeplink/compose",
  download_url: "https://openboard.events/cal/sample/session",
  buttons_html: '<p><a href="#">Add to Google Calendar</a> · <a href="#">Add to Outlook</a> · <a href="#">Download</a></p>',
};

export const SAMPLE_VARS: Record<TemplateKey, TemplateVars> = {
  submission_received: { ...common, submission },
  submission_accepted: { ...common, submission },
  submission_declined: { ...common, submission },
  task_assigned: { ...common, task, tasks },
  task_reminder: { ...common, task, tasks },
  schedule_assigned: { ...common, session, calendar },
  schedule_changed: { ...common, session, calendar },
  portal_login: { ...common, otp: { code: "482913" } },
};

/**
 * The variable picker (step 3): a dotted-path chip list walked straight off
 * `TEMPLATE_VAR_SCHEMAS[key]`'s zod shape, never a hand-listed copy — the
 * picker cannot drift from what `validateTemplateBody` actually allows,
 * because they read the same contract.
 */
function collectPaths(schema: z.ZodType, prefix: string[]): string[] {
  if (schema instanceof z.ZodObject) {
    return Object.entries(schema.shape).flatMap(([key, value]) => collectPaths(value as z.ZodType, [...prefix, key]));
  }
  return [prefix.join(".")];
}

export function templateVariablePaths(key: TemplateKey): string[] {
  return collectPaths(TEMPLATE_VAR_SCHEMAS[key], []);
}
