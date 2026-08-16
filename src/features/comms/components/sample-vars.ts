import { TEMPLATE_VAR_SCHEMAS, isTransactionalTemplate, type TemplateKey, type TemplateVars } from "@/shared/contracts";
import { z } from "zod";

/**
 * Fixture context for the live preview panel (step 3) — every field
 * `TEMPLATE_VAR_SCHEMAS[key]` requires, filled with a plausible value so
 * `renderTemplateContent` never throws `TEMPLATE_VAR_MISSING` on a fresh page
 * load.
 */
const common = {
  event: { name: "AI Engineer World's Fair", start_date: "September 15, 2026", location: "Fort Mason, San Francisco", timezone: "PDT" },
  speaker: { first_name: "Nadia", last_name: "Lee", email: "nadia@example.com" },
  portal: { magic_link: "https://openboard.events/portal/ai-engineer/verify?token=sample" },
  unsubscribe: { url: "https://openboard.events/portal/ai-engineer/unsubscribe?token=sample" },
};

const adminCommon = { event: common.event, speaker: common.speaker, unsubscribe: common.unsubscribe };
const adminAuth = {
  name: "Nadia",
  action_url: "https://openboard.events/login/reset?token=sample",
  expires_in: "1 hour",
};

const submission = { title: "Scaling agentic workflows in production", code: "SESS-142" };
const task = { name: "Upload your headshot", due_date: "September 1, 2026" };
const tasks = { outstanding_list: "<ul><li>Upload your headshot — September 1, 2026</li></ul>" };
const session = {
  title: "Scaling agentic workflows in production",
  start_time_local: "10:00 AM",
  end_time_local: "10:40 AM",
  timezone: "PDT",
  room: "Bayview",
  track: "AI Agents",
};
const review = {
  round: "Round 1 — first read",
  queue_url: "https://openboard.events/events/sample/review",
  outstanding: "6",
  closes_at: "September 1, 2026, 5:00 PM PDT",
};
const calendar = {
  google_url: "https://calendar.google.com/calendar/render?action=TEMPLATE",
  outlook_url: "https://outlook.live.com/calendar/0/deeplink/compose",
  download_url: "https://openboard.events/cal/sample/session",
  buttons_html: '<p><a href="#">Add to Google Calendar</a> · <a href="#">Add to Outlook</a> · <a href="#">Download</a></p>',
};
const invite = {
  organization_name: "Acme Events",
  inviter_name: "owner@example.com",
  role: "organizer",
  action_url: "https://openboard.events/join?token=sample",
  expires_at: "September 1, 2026, 5:00 PM PDT",
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
  reviewer_invited: { ...common, review },
  review_reminder: { ...common, review },
  speaker_bulk_message: { ...common },
  // M42 — admin auth mail has no `portal` key (see TEMPLATE_VAR_SCHEMAS): an
  // organizer resetting their admin password is not handed a speaker-portal
  // link.
  admin_password_reset: { ...adminCommon, admin: adminAuth },
  admin_email_verification: { ...adminCommon, admin: adminAuth },
  // M44 — team invitations have no `portal` key either, for the same reason.
  organization_invited: { ...adminCommon, invite },
};

/**
 * The variable picker (step 3): a dotted-path chip list walked straight off
 * `TEMPLATE_VAR_SCHEMAS[key]`'s zod shape, never a hand-listed copy — the
 * picker cannot drift from what `validateTemplateBody` actually allows,
 * because they read the same contract.
 */
export function collectVariablePaths(schema: z.ZodType, prefix: string[] = []): string[] {
  // Unwrap first, and keep unwrapping. `portal` became `.optional()` when the
  // magic link stopped being minted for every template, and a `ZodOptional` is
  // not a `ZodObject` — so the walk stopped one level short and yielded the
  // bare `portal`. That broke the picker in both directions at once: the chip
  // inserted `{{portal}}`, which `TOKENS_BY_KEY` rejects at save or send time,
  // and `{{portal.magic_link}}` was no longer in the allowed list, so
  // `unknownTokensClientSide` flagged it — disabling Save on the five shipped
  // default templates that use it. The doc comment above promises the picker
  // "cannot drift from what `validateTemplateBody` actually allows"; unwrapping
  // is what keeps that true for any wrapper a contract picks up later.
  //
  // A loop rather than one unwrap because wrappers nest: `.nullish()` is
  // `ZodOptional(ZodNullable(...))` and `.optional().default({})` is
  // `ZodDefault(ZodOptional(...))`, either of which would put the bare-prefix
  // bug straight back if we peeled exactly one layer.
  let unwrapped = schema;
  while (unwrapped instanceof z.ZodOptional || unwrapped instanceof z.ZodNullable || unwrapped instanceof z.ZodDefault) {
    unwrapped = unwrapped.def.innerType as z.ZodType;
  }
  if (unwrapped instanceof z.ZodObject) {
    return Object.entries(unwrapped.shape).flatMap(([key, value]) => collectVariablePaths(value as z.ZodType, [...prefix, key]));
  }
  return [prefix.join(".")];
}

/**
 * The allowlist half of the picker: every token the contract defines for a
 * key, deliberately *unfiltered*. This is what `unknownTokensClientSide`
 * checks a body against, so it mirrors the server's `TOKENS_BY_KEY` exactly —
 * the editor must never reject a body that `validateTemplateBody` accepts.
 * `templateVariablePaths` narrows this for the chip list; the two differ on
 * purpose (see below).
 */
export function templateVariableTokens(key: TemplateKey): string[] {
  return collectVariablePaths(TEMPLATE_VAR_SCHEMAS[key]);
}

export function templateVariablePaths(key: TemplateKey): string[] {
  const paths = templateVariableTokens(key);
  // `unsubscribe.url` renders without a token on a transactional key —
  // `buildContext` appends `?token=` only when `!isTransactionalTemplate` —
  // and the unsubscribe page rejects a tokenless link as invalid or expired.
  // Offering the chip meant an organizer editing `submission_accepted` could
  // click it, save without complaint, and ship a guaranteed-broken link in
  // every acceptance email. `emailLayout` already suppresses its own footer
  // link for these keys; the picker was the hole left in that policy.
  //
  // Filtered here rather than removed from `TOKENS_BY_KEY`, so a template
  // already saved with the token keeps validating and stays editable — an
  // organizer must not discover a body they saved months ago has become
  // unsaveable. That promise is only kept because the *chip list* is filtered
  // and the *allowlist* (`templateVariableTokens`) is not: routing the editor's
  // unknown-token check through this filtered list instead would flag such a
  // body as an unknown variable and disable Save, which is precisely the
  // failure the sentence above rules out.
  return isTransactionalTemplate(key) ? paths.filter((path) => path !== "unsubscribe.url") : paths;
}
