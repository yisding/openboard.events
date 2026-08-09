# Feature Analysis: Submission Form Builder (conditional logic + routing)

Area: Admin form builder — Program > Submission Forms > Create/Edit. Source: 11 screenshots of the real Sessionboard product ("AI.Engineer Sandbox" event, Oct 12–14 2026) plus the hackathon brief. The brief's primary feature this maps to: **"Custom call-for-speakers submission forms with conditional logic and category-based routing"** — one of the firm requirements.

Important caveat: none of the screenshots directly show the conditional-logic rule editor or an explicit routing UI. What IS shown is the full 7-step form-builder wizard, the field-card list with per-field `...` overflow menus (where field editing/conditions live), and Dropdown category fields (Format, Tags, Track, Level) which are the natural drivers of category-based routing into evaluation. The brief text makes conditional logic + routing [CORE] regardless, so this doc specifies a concrete design for both.

---

## What the screenshots show — per screenshot

### 1. `10000201000008000000057B3C3CA681748F6FE9.png` — Forms list (Program > Forms)
- **Global chrome** (identical in all admin screenshots): top search bar "Find or ask" with `⌘K` shortcut hint; "View Portal" button; megaphone/announcements icon with red notification dot; "?" help; user avatar "SY".
- **Left sidebar nav** (identical everywhere): event switcher card "AI.Engineer Sand… / Oct 12–14, 2026" with up/down chevron; `Dashboard`; `Program` (expanded) containing: `Overview`; section **SUBMISSIONS**: `View All`, `Abstracts`, `Sessions`, `Files`; section **COLLECT & REVIEW**: `Forms` (active/highlighted), `Evaluation`, `Agenda`, `Invoices`, `Site`; section **PORTALS**: `Portals`, `Tasks`, `Forms`, `File Requests`, `Resources`, `Files`; section **CONFIGURE**: `Settings`; below Program: `CRM` (collapsed, expandable). Note the nav distinguishes admin-side Forms (Collect & Review) from portal-side Forms (Portals).
- **Page header**: icon + "Submission Forms — Collect abstract, session and participant information for your event". Right: **"+ Add" split-dropdown** whose menu shows **"Create Form"** (highlighted; a red arrow annotation points to it) and **"Copy from…"** (duplicate an existing form).
- **Promo banner** (dismissible ×): "Collect submissions year-round with Speaker CRM" + "NEW" badge; body text about accepting abstracts/session proposals/speaker interest forms year-round; "Learn more" button; "No commitment required — see it in action first". (Upsell — ignore for clone.)
- **"Search forms…"** text input.
- **Status tabs with counts**: `All 3` (active) | `Open 3` | `Closed 0`.
- **Sort dropdown**: "Most Pending" (implies other sorts, e.g. newest/name).
- **Form cards**, each showing: leading circular count badge (pending-submission count: 1, 1, 0), form name, status pill (`Open`, dark), tag chips (`Abstracts & Participants`, `V2`), meta line `N submissions · N drafts` plus optional `Closes Sep 15, 2026`, right-aligned `Created Aug 7, 2026`, and a `...` overflow menu:
  - "Session Submission Form #2" — Open, Abstracts & Participants, V2, 1 submissions · 0 drafts, Created Aug 7, 2026.
  - "Session Submission Form #3" — Open, Abstracts & Participants, V2, 1 submissions · 0 drafts · **Closes Sep 15, 2026**, Created Aug 7, 2026.
  - "Submission Form" — Open, V2 (no participants chip → participants step disabled), 0 submissions · 0 drafts, Created Aug 6, 2026.
- Takeaways: multiple forms per event; per-form open/closed lifecycle derived from close date; per-form drafts vs submissions counts; forms are typed by what they collect (abstracts vs sessions, ± participants).

### 2. `100002010000080000000586CCEB266D96F3DD53.png` — Wizard step 1: Submission Setup
- Page header becomes "Edit Session Form / Session Submission Form #4" with actions: **View Form** (opens public form, external-link icon), **Copy Link** (public URL to clipboard), **Save** (primary).
- **Left wizard rail** "FORM SETUP" with "← Back to forms" above it. Seven steps, each icon + title + subtitle; current step dark-highlighted; completed steps get checkmarks (seen in later screenshots):
  1. **Submission Setup** — "Submission type and participants" (active)
  2. **Welcome Screen** — "Welcome message and terms"
  3. **Abstract Information** — "Session or abstract questions"
  4. **Participant Information** — "Participant and contact fields"
  5. **Payments & Fees** — "Fees, gateway, and promo codes"
  6. **Form Settings** — "Deadlines, limits, and success page"
  7. **Notifications** — "Admin alerts and email templates"
- Main panel: card header "Submission Setup — Submission type and participants". Question: "**What kind of submissions do you want to collect?** Choose what submitters will send and whether to collect participant details."
- Info banner (ⓘ): "You can adjust these choices later by editing this form."
- **Two radio-cards**: **Abstracts** — "Collect abstract submissions for review before sessions are finalized." (selected, blue border) | **Sessions** — "Collect full session proposals with details for your program."
- **Participants toggle row** (boxed, emphasized): "Participants — Include a step to collect speaker and participant contact information." Toggle ON.
- Footer: `Back` (disabled on first step) and `Next` (primary, bottom-right).

### 3. `10000201000008000000064E1BA44C19F90910D2.png` — Wizard step 2: Welcome Screen
- Step 1 shows a checkmark; Welcome Screen active.
- Card: "Welcome Screen — Welcome message and terms". Caption: "The first screen a user will see before submitting their abstract."
- Fields:
  - **Internal Form Name*** — text, live char counter `26/255`, value "Session Submission Form #4", with a red icon inside the input (validation/annotation marker).
  - **External Form Title*** — text, `21/255`, value "Welcome to our event!".
  - **Page Heading*** — "(15 char max)", value "Welcome!". (Page headings are the short per-step labels shown in the public form's stepper.)
- **Welcome Message** block with **"Show message" toggle** (on) and a full **WYSIWYG editor** — toolbar: Bold, Italic, Underline, superscript (x²), subscript (x₂), link, bulleted list, numbered list, outdent, indent, align left/center/right, insert image, `...` overflow. Sample content: heading "Call for Speakers" + paragraph "Our event is the premiere event welcoming leaders, practitioners, and change-makers… Sessions for our agenda will be selected from these submissions." Editor has a drag-resize corner.
- Footer Back/Next. (Subtitle mentions "terms", so this step likely also hosts a terms-acceptance block below the fold.)

### 4. `100002010000080000000584F378F66FC8C56FED.png` — Wizard step 3: Abstract Information (section config + first question)
- Steps 1–2 checkmarked; Abstract Information active.
- Card: "Abstract Information — Session or abstract questions".
- Section-level config:
  - **Section Title*** — text `29/255`, value "Tell us about your submission".
  - **Page Heading*** — "(15 char max)", value "Submission".
  - **Description & Instructions*** — WYSIWYG (same toolbar), value "What do you want to present? Fill out the following information to tell us more."
- Panel: "Collect information about submitted abstracts." Then **"Form Questions"** header with **"+ Add Field"** button (top-right).
- First question card partially visible: **Title** * with **"Locked"** badge, type **Text**, chip **"Max 255 chars"**, **Required toggle** (on, greyed = not editable because locked), `...` overflow menu, and a 6-dot **drag handle** on the left.

### 5. `1000020100000800000005820AD775F0B01EA89E.png` — Wizard step 3 scrolled: full default question list (abstract section)
- The default/pre-seeded abstract question cards, each: drag handle, label, required asterisk, type caption, optional char-limit chip, right-side **Required toggle**, `...` menu:
  - **Title*** `Locked` — Text, Max 255 chars — Required ON (toggle greyed/disabled).
  - **Description*** — Wysiwyg, Max 5,000 chars — Required ON.
  - **Format*** — Dropdown — Required ON.
  - **Tags*** — Dropdown — Required ON.
  - **Track*** — Dropdown — Required ON.
  - **Level** — Dropdown — Required OFF.
- "+ Add Field" button repeated at panel top-right. Back/Next footer.
- Takeaways: field types observed so far: Text, Wysiwyg, Dropdown; a "Locked" system field (Title) that cannot be made optional/deleted; per-field required toggling inline; drag-to-reorder; Format/Tags/Track/Level are the **category fields** that drive routing.

### 6. `100002010000080000000584F7C9B8125EA5C1AC.png` — Wizard step 4: Participant Information (section config + roles)
- Steps 1–3 checkmarked; Participant Information active.
- Section config: **Section Title*** "Tell us about you" `17/255`; **Page Heading*** "Participant"; **Description & Instructions*** WYSIWYG "Give us information about yourself and your credentials for presenting at our event."
- **Participant roles** panel (collapsible chevron): "Choose which roles submitters can add. Optionally set **minimum and maximum counts per role**, and **overall limits across all roles**."
  - Role row: leading **checkbox** (checked), role icon, name "Speaker" with sub-label "Speaker", **Min** numeric input (empty "—"), **Max** numeric input (empty "—"). A dashed outline below hints at more role rows (e.g. Moderator/Panelist) below the fold.
- Back/Next.

### 7. `10000201000008000000058ACBBABDC56911DA2E.png` — Wizard step 4 scrolled: participant question list
- Caption: "Collect information for participants and the primary contact for this submission."
- "Form Questions" + "+ Add Field". Default participant fields:
  - **First Name*** `Locked` — Text, Max 255 chars — Required ON.
  - **Last Name*** `Locked` — Text, Max 255 chars — Required ON.
  - **Email*** `Locked` — **Email** type — Required ON.
  - **Mobile Phone** — **Phone** type — Required OFF.
  - **Biography** — Wysiwyg, Max 5,000 chars — Required OFF.
- Adds two more field types: Email, Phone. Locked identity fields (First/Last/Email) anchor dedupe/portal accounts.

### 8. `1000020100000800000005773D1B8638594687DF.png` — Wizard step 5: Payments & Fees — **annotated "NOT NEEDED"**
- Card: "Payments & Fees — Fees, gateway, and promo codes". Caption "Configure how and when fees are collected for this form."
- Section "**When to Collect Payment**" with radio option cards; the first option is covered by a giant red "**NOT NEEDED**" annotation from the organizer; the visible second option: "**Upon Submission** — Payment is collected when the submission is completed and submitted."
- Clone directive: the whole Payments step is explicitly out of scope. At most render a disabled placeholder step.

### 9. `10000201000008000000056E3BAA22B7D3015077.png` — Wizard step 6: Form Settings (deadlines + capacity) — **annotated "kinda impt"**
- Steps 1–5 checkmarked; Form Settings active.
- Card: "Form Settings — Deadlines, limits, and success page". Caption: "Configure submission deadlines, limits, and post-submission behavior."
- **Deadlines** section: "When the form stops accepting new and updated submissions."
  - **Close Date** card: "If set, form and submissions will close after specified date." Input: calendar-icon **"Select date and time"** picker. Helper: "**Set a close date to enable draft reminder emails.**" Red annotation "**kinda impt**" points at the picker.
- **Submission capacity** section: "How many sessions each submitter may have, and how saved drafts work on the portal."
  - Toggle **"Set Submission Limit"** — "Limit how many sessions one user may have for this form. Includes saved drafts and submitted sessions." (off)
  - Chip "**Event max: 3**" — "Applies when no form-level limit is set." (event-level default cap; form-level overrides)
  - Toggle **"Allow multiple draft submissions"** (off).
- Back/Next.

### 10. `10000201000008000000052AAE95D1B846A80AF9.png` — Wizard step 6 scrolled: After submission + validation rules — **annotated "make sure this works"**
- **After submission** section: "What submitters see on the confirmation page after they complete the form."
  - Toggle **"Auto-redirect to speaker portal"** (ON) — "After 10 seconds on the confirmation page. If off, submitters use Continue to portal."
  - "**Customize the success page message:**" — red annotation "**make sure this works**" points here. WYSIWYG editor with sample content: "You will receive a confirmation email shortly with a link to your speaker portal. We will review sessions over the next few weeks and then notify you regarding your status." / "Next, you will be logged into your speaker portal where you can see if there are any tasks to complete." / "If you would like to submit another session, please **click here** to return to the submission form." (rich text incl. hyperlink).
- **Validation rules** section: "Combined character limits across several text fields."
  - Card **"Cross-field character limits"** — "Cap the combined length of several text fields (for example a printed program block). Submitters see a **live combined counter**; speaker-field rules apply to **each participant**." Button **"+ Add rule"**.
- Back/Next.

### 11. `10000201000008000000058CA3DD93A4ECEBBE30.png` — Wizard step 7: Notifications — **annotated "nice to have" / "must have"**
- Card: "Notifications — Admin alerts and email templates". Caption: "Choose who receives admin alerts and customize automated emails for this form."
- **Admin alert recipients** (annotated "**nice to have**"):
  - "What admins should be notified when a new submission is received?" — multi-select with removable chip `Sw yx ×`.
  - "What admins should be notified when an existing submission is updated?" — same chip control.
- **Submitter notifications** collapsible ("1 template", expanded), annotated "**must have**":
  - Row: **"Submission Confirmation — Email sent to the submitter after a successful submission"** — enable **toggle** (ON) + **"Customize"** button (template editor).
- **Admin notifications** collapsible ("2 templates", collapsed, chevron →) — presumably New-submission and Submission-updated templates.
- Final step: footer shows **Save** (not Next). Top-left tooltip "View all my organizations" visible over the logo (multi-org hint; irrelevant to clone).

### Cross-screenshot synthesis
- Builder = 7-step wizard with persistent Save, per-step Back/Next, completed-step checkmarks, live "View Form" preview and public "Copy Link".
- Public form (per the brief's CFP URL `…/submit/ai-engineer-sandbox-event/<uuid>`) is a multi-step flow: Welcome → Submission (abstract Qs) → Participant(s) → Review/Submit → Success page, with the configured Page Headings as stepper labels.
- Field types explicitly observed: **Text, Wysiwyg (rich text), Dropdown, Email, Phone**. "+ Add Field" implies a type picker; a good-enough palette adds Textarea, Checkbox(es), Radio, Number, Date, URL, File upload.
- Conditional logic & routing UI not captured in screenshots; the per-field `...` menu is the anchor point for "Edit field / options / conditional visibility / delete"; Dropdowns (Format, Tags, Track, Level) supply the categories used for routing.

---

## Required capabilities

Numbered functional requirements for a good-enough clone. [CORE] = in the brief's primary feature ("Custom call-for-speakers submission forms with conditional logic and category-based routing") or demanded by organizer annotations; [NICE] = visible in the product but not demanded.

**Forms list & lifecycle**
1. [CORE] CRUD submission forms scoped to an event; list view showing name, status (Open/Closed), submissions count, drafts count, close date, created date.
2. [CORE] Form status derived from close date + explicit open flag: Open ⇄ Closed; closed forms reject new submissions and edits with a friendly public message.
3. [NICE] Status tabs with counts (All/Open/Closed), search-by-name, sort (Most Pending / Newest).
4. [NICE] "Copy from…" — duplicate an existing form (deep-copies sections, fields, rules, settings; not submissions).
5. [CORE] Per-form public URL (slug or UUID) + "Copy Link" + "View Form" preview from the builder.

**Builder wizard shell**
6. [CORE] Multi-step builder: Submission Setup, Welcome Screen, Abstract Information, Participant Information, Form Settings, Notifications (Payments omitted — annotated NOT NEEDED). Steps navigable via left rail; Back/Next; completed-step indicators; a global Save that persists partial configuration (form is a draft until published/opened).
7. [CORE] Submission Setup: choose submission kind — Abstracts vs Sessions (in clone: a label/flag on the form; both behave identically enough) — and a Participants toggle that adds/removes the participant step on the public form.
8. [CORE] Welcome Screen config: internal form name (admin-only), external form title, page heading (15-char max), optional rich-text welcome message with show/hide toggle.
9. [CORE] Per-section config (abstract + participant sections): Section Title (255 max, counter), Page Heading (15 max), rich-text Description & Instructions.

**Fields**
10. [CORE] Field list per section with: add field, inline rename, required toggle, drag-and-drop reorder, delete, and per-field `...` menu (edit/settings/duplicate/delete).
11. [CORE] Field types minimum: Text (single-line, max-chars), Textarea/Wysiwyg (rich text, max-chars), Dropdown (single-select with admin-managed option list), Email, Phone. Strongly recommended additions: Multi-select/Checkboxes, Radio, Number, Date, URL, File upload (file upload matters for headshots/slides elsewhere).
12. [CORE] Locked system fields that cannot be deleted or made optional: abstract.Title; participant.FirstName, participant.LastName, participant.Email. Show "Locked" badge; Required toggle rendered disabled-on.
13. [CORE] Per-field validation config: required, max chars (with live public counter), type-intrinsic validation (email format, phone, URL, number range).
14. [CORE] Default field templates seeded on form creation: abstract → Title*, Description*, Format*, Tags*, Track*, Level; participant → First Name*, Last Name*, Email*, Mobile Phone, Biography.
15. [NICE] Participant roles: enable/disable roles (Speaker, Moderator, Panelist…), per-role min/max counts and overall participant cap; public form lets the submitter add N participants each with a role.

**Conditional logic + routing (the headline requirement)**
16. [CORE] Conditional visibility rules per field (and ideally per section): show/hide target when `<source field> <operator> <value>`, operators at least: equals, not-equals, contains/any-of (for multi-select), is-answered/is-empty. Multiple conditions combined with ALL/ANY. Source fields limited to earlier-evaluated choice/text fields to avoid cycles.
17. [CORE] Conditional logic evaluated live on the public form (hide/show instantly, no reload), and hidden-field answers are excluded from validation AND cleared/ignored at submit.
18. [CORE] Category-based routing: rules mapping a category answer (e.g. Track = "AI Infrastructure", Format = "Workshop") to a routing outcome — at minimum auto-assigning the submission to a category/track/queue visible in the review pipeline (Program > Abstracts) and usable to filter/assign reviewers. Rule shape: `when <field> <op> <value> → set category/track = X (and optionally: assign reviewer group Y, apply tag Z)`.
19. [NICE] Rule builder UX niceties: reorder rules, first-match vs all-match semantics, per-rule enable toggle, human-readable rule summary line.

**Form settings**
20. [CORE — "kinda impt"] Close Date (date + time, timezone-aware) that closes the form for new AND updated submissions after the instant passes; drives reminder emails for unfinished drafts (email module's concern, but the builder stores the date).
21. [NICE] Submission capacity: per-form submission limit toggle + number; event-level default cap ("Event max: 3") applied when no form-level limit. (The real product's "allow multiple draft submissions" toggle is deliberately out of scope — the clone fixes one server draft per contact/form; see the SubmissionForm entity and simplification 9.)
22. [CORE — "make sure this works"] Success page: customizable rich-text success message rendered on the public confirmation page, plus "Auto-redirect to speaker portal" toggle (10-s delay; when off show a "Continue to portal" button).
23. [NICE] Cross-field character limits: named rule = set of text fields + combined max; live combined counter on the public form; applied per-participant for participant fields.

**Notifications (builder-side config only; sending is the comms module)**
24. [CORE — "must have"] Submission Confirmation email to submitter on successful submit: enable toggle + customizable template (subject/body with merge tags like {{first_name}}, {{submission_title}}, {{portal_link}}).
25. [NICE] Admin alerts: multi-select of admin recipients for (a) new submission received, (b) existing submission updated; 2 admin templates.

**Public form runtime (consumer of builder config)**
26. [CORE] Public multi-step form at a stable URL: Welcome (title, heading, message) → Abstract questions → Participant step (roles, per-participant fields, add/remove participant) → Review? → Submit → Success page. Mobile-friendly. No login required to start.
27. [CORE] Draft persistence: submitter can save/leave and resume (drafts counted separately from submissions in the admin list); resume via emailed link or portal.
28. [CORE] Post-submit: create Submission (status "New/Pending"), fire routing rules, send confirmation email, redirect/link to speaker portal; allow the submitter to edit their submission until the close date (edits trigger the "updated" admin alert).
29. [NICE] Live char counters (per field and combined), inline validation errors, keyboard-accessible.

---

## Data entities

- **Event** — id, name, slug, start/end dates, timezone, event-level submission cap (`event_max`). Parent of everything.
- **SubmissionForm** — id, event_id, internal_name, external_title, page_heading, welcome_message_html, show_welcome (bool), kind (`abstracts` | `sessions`), collect_participants (bool), status (`draft`|`open`|`closed`), close_at (timestamptz, nullable), submission_limit (int, nullable), success_message_html, auto_redirect_to_portal (bool), public_slug/uuid, created_at/updated_at. Has many sections, routing rules, notification settings. The multiple-drafts toggle is omitted; one server draft per contact/form is the fixed implementation rule.
- **FormSection** — id, form_id, key (`abstract` | `participant`), title, page_heading, description_html, sort_order. Has many fields. (Fixed two sections is enough; a generic sections table future-proofs multi-section forms.)
- **FormField** — id, section_id, label, key (stable machine name for answers/merge tags), type (`text`|`wysiwyg`|`dropdown`|`multiselect`|`radio`|`checkbox`|`email`|`phone`|`number`|`date`|`url`|`file`), required (bool), locked (bool), max_chars (int, nullable), help_text, sort_order, options (jsonb: [{id, label, value, sort}] for choice types), config (jsonb for type extras).
- **FieldVisibilityRule** — id, target_field_id (or target_section_id), match (`all`|`any`), conditions (jsonb: [{source_field_id, operator, value}]), enabled. Alternative: store as `conditions jsonb` column on FormField — simpler, fine for the clone.
- **RoutingRule** — id, form_id, sort_order, match (`all`|`any`), conditions (jsonb, same shape), action (jsonb: {set_category_id?, set_track?, assign_reviewer_group_id?, add_tag?}), enabled. Applied at submit time; result stamped onto the Submission.
- **Category / Track** — id, event_id, name, color; the routing target; referenced by Evaluation & Agenda modules. (Dropdown options for Track/Format fields can either reference these or just be strings synced to them.)
- **ParticipantRoleConfig** — id, form_id, role (`speaker`|`moderator`|`panelist`|…), enabled, min_count, max_count; plus form-level overall participant max.
- **Submission** — id, form_id, event_id, status (`draft`|`submitted`|plus review statuses owned by evaluation module), title (denormalized from locked Title answer), category_id/track (routing output), submitted_at, updated_at, submitter_contact_id, answers relation. Draft vs submitted drives the list counts.
- **SubmissionAnswer** — id, submission_id, field_id, participant_id (nullable — null = abstract-section answer), value (jsonb: string | string[] | file ref). One row per field (per participant for participant fields).
- **SubmissionParticipant** — id, submission_id, role, sort_order, is_primary_contact (bool), speaker_id/contact_id (link to global Speaker record once admitted). Answers hang off it.
- **CrossFieldLimitRule** — id, form_id, name, field_ids (jsonb), max_total_chars, applies_per_participant (bool).
- **FormNotificationSetting** — id, form_id, kind (`submitter_confirmation`|`admin_new`|`admin_updated`), enabled, recipient_admin_ids (jsonb, admin kinds only), template_id → **EmailTemplate** (subject, body_html, merge-tag support; shared with the comms module).
- **AdminUser** — id, name, email; recipients of admin alerts; owner of builder actions.

Relationships: Event 1—N SubmissionForm 1—N FormSection 1—N FormField; FormField 1—N FieldVisibilityRule; SubmissionForm 1—N RoutingRule/CrossFieldLimitRule/FormNotificationSetting/ParticipantRoleConfig; SubmissionForm 1—N Submission 1—N SubmissionParticipant and 1—N SubmissionAnswer; RoutingRule → Category ← Submission.

---

## User flows

### Organizer: create & publish a form
1. Program > Forms → "+ Add" → "Create Form" (or "Copy from…" an existing form).
2. Step 1 Submission Setup: pick Abstracts or Sessions; toggle Participants on. Next.
3. Step 2 Welcome Screen: set internal name, external title, page heading; toggle + author welcome message. Next.
4. Step 3 Abstract Information: edit section title/heading/instructions; review seeded fields (Title locked, Description, Format, Tags, Track, Level); "+ Add Field" → pick type → label, options (for dropdowns), max chars, required; drag to reorder; open a field's `...` → add conditional visibility rule (e.g. show "Workshop duration" only when Format = "Workshop"). Next.
5. Step 4 Participant Information: edit section copy; enable roles + min/max; review seeded contact fields; add custom fields (e.g. "Company", "Twitter/X URL"). Next.
6. (Payments — skipped in clone.) Step 5 Form Settings: set Close Date (event timezone); optionally submission limit; author success-page message; leave auto-redirect on. Next. (No multiple-drafts toggle — one server draft per contact/form is fixed.)
7. Step 6 Notifications: keep Submission Confirmation ON, customize its template; pick admin recipients for new/updated alerts. Save.
8. Configure routing: rules panel (builder step or form-level tab): "Track = Infra → Category: Infrastructure", "Format = Workshop → Category: Workshops". Reorder; save.
9. "View Form" to preview the public flow; "Copy Link"; share URL. Form shows as Open in the list.

### Organizer: manage forms
- Search/filter Open vs Closed; watch pending count badges; open a form card's `...` to edit/duplicate/close/delete; edit a live form (config changes apply to future renders; see bug traps).

### Public visitor / prospective speaker: submit
1. Opens public URL (no auth) → Welcome page: title, heading, message, Start.
2. Abstract step ("Submission"): fills Title, Description (rich text, live 5,000-char counter), Format/Tags/Track/Level dropdowns; conditionally-shown fields appear as answers change; combined counters update if cross-field rules exist.
3. Participant step ("Participant"): fills own contact info (First/Last/Email locked-required, Phone, Bio); "Add participant" for co-speaker with role picker, within role min/max.
4. Can "Save draft" and leave; resumes later via the portal; drafts are counted separately in admin but do **not** consume the submission limit.
5. Submit → validation across all visible fields → Success page with custom message → confirmation email with portal link → auto-redirect to speaker portal after 10 s (or Continue button).
6. Until close date: may return to edit the submission (triggers admin "updated" alert) or submit another session (subject to limits) via the success-page "click here" link.

### Reviewer (downstream consumer)
1. Program > Abstracts/View All: sees new submissions already stamped with category/track from routing rules.
2. Filters by category; evaluation module assigns/scoring per category queue. (Routing's job ends at the stamp + optional reviewer-group assignment.)

### Speaker (post-submission, downstream)
1. Receives confirmation email → speaker portal → sees submission status, outstanding tasks; edits submission while the form remains open.

---

## Edge cases & bug traps

1. **Close-date timezone**: "Closes Sep 15, 2026" must be an absolute timestamptz entered in the event's timezone and enforced server-side at submit time — not client clock, not date-only. A submit racing the deadline should be accepted/rejected by the server check alone. Naive `new Date(string)` parsing in the viewer's locale will drift by hours.
2. **Closing also blocks edits**: the setting says forms *and submissions* close — existing submissions become read-only after close. Easy to forget the edit path.
3. **Hidden-by-condition required fields**: a required field hidden by conditional logic must not block submit, and its stale answer must be cleared or ignored server-side (user picks Workshop → fills duration → switches to Talk → duration must not persist/validate). Validate against the *evaluated* visibility set, computed server-side from the rules — never trust the client's visibility claims.
4. **Rule cycles & dangling references**: field A shows-if B, B shows-if A; or a rule references a deleted field/option. Restrict sources to earlier fields (or detect cycles), and cascade-clean or soft-disable rules when a field/option is deleted; renaming a dropdown option must not orphan rules (match on option id, not label).
5. **Builder edits vs in-flight drafts**: deleting/retyping a field while public drafts hold answers to it. Simplest safe policy: answers keyed by field_id; deleted fields' answers ignored at render/validate; never hard-delete answer rows. Changing a field's type with existing answers should be blocked or coerced explicitly.
6. **Concurrent builder edits / lost updates**: two admins (or two tabs) editing the same form — last Save wins silently and can resurrect deleted fields. Use updated_at optimistic concurrency and return 409 on stale writes.
7. **Locked-field invariants**: enforce server-side that Title/FirstName/LastName/Email can't be deleted, un-required, or retyped — not just disabled in UI.
8. **Draft vs submission counting & limits**: "Includes saved drafts and submitted sessions" — the limit check must count both, atomically (unique-ish constraint or serialized check) so double-click/two-tab submits can't exceed the cap; also decide dedupe identity for anonymous public drafts (cookie/localStorage token + email).
9. **Email as identity**: participants keyed by email → normalize (trim/lowercase); same email as co-speaker on two submissions must not create conflicting portal accounts; typo'd emails mean orphaned portals — allow admin-side email correction.
10. **Rich text safely**: Wysiwyg answers and admin-authored messages render on public pages — sanitize HTML (XSS via submission Description rendered in admin review is a classic stored-XSS hole). Char limits on rich text: count text content, not HTML markup, and enforce server-side.
11. **Char counters vs server truth**: live counters (per-field and cross-field combined) are UX; server must re-validate max/combined limits — and define counting (Unicode code points, not UTF-16 units) consistently client/server.
12. **Participant min/max**: min>max misconfig, min unmet on submit, removing the primary contact participant, and cross-field rules "apply to each participant" (per-participant evaluation, not summed across participants).
13. **Empty states**: form with zero custom fields, no routing rules (submissions must land in an "Uncategorized" bucket, not error), dropdown with zero options (block publish or hide field), Closed tab with 0, event with no categories yet.
14. **Reorder races**: drag-and-drop with fractional/int sort orders across concurrent saves; renumber transactionally.
15. **Success-page redirect**: 10-second auto-redirect must be cancellable and must not fire if the portal session isn't established; annotated "make sure this works" — test the off state (Continue button) too.
16. **Duplicate "Copy from…"**: deep-copy must remap all internal FK references (visibility rules pointing at old form's field ids is the classic bug); reset counters/slug/close date sensibly.
17. **Notification fan-out**: confirmation email must be enqueued transactionally with submission creation (outbox pattern) — not sent-then-fail-insert or insert-then-crash-before-send; "updated" alerts need debounce (one edit session ≠ 15 emails).
18. **Public URL stability**: slug/uuid must survive form renames; renaming internal name must not 404 shared CFP links.
19. **Serverless/Workers constraints**: OpenNext on Cloudflare — no long-lived in-memory state for draft autosave; use DB-backed drafts; Neon connection handling (HTTP driver/pooling) under burst submits near the deadline.

---

## Simplifications

Where the clone can be simpler than Sessionboard without losing the brief's intent:

1. **Drop Payments & Fees entirely** — explicitly annotated NOT NEEDED. Keep the wizard at 6 steps (or show a disabled placeholder).
2. **Skip Speaker CRM banner, multi-org, V1/V2 forms, invoices** — "V2" chips, org switcher, promo banners are SaaS chrome; one org, one form engine.
3. **Merge Abstracts/Sessions kinds** — store the kind as a label; identical behavior. The distinction only matters as display text and a chip on the card.
4. **Fixed two sections** (abstract + participant) instead of arbitrary multi-section forms — matches everything shown; keep sections as data so it can grow.
5. **Conditions as JSON on the field** rather than a separate rules service: `{match: "all", conditions: [{field, op, value}]}` evaluated by one shared TS function used verbatim on client (live show/hide) and server (validation) — one evaluator, zero drift, ideal for parallel AI agents (typed contract in a shared package).
6. **Routing = stamp a category/track onto the submission** at submit time via ordered first-match rules. No reviewer-group auto-assignment needed for CORE; reviewers filter by category in the evaluation module.
7. **Simplify Wysiwyg**: one lightweight rich-text editor (e.g. TipTap) with B/I/U, lists, link — skip superscript/subscript/image-upload/alignment; or even Markdown-with-preview for submitter-facing long text. Sanitize on save.
8. **Participant roles**: hardcode role list (Speaker, Co-speaker/Panelist, Moderator) with optional min/max; skip per-role icons and "overall limits across all roles" if time-pressed (form-level max participants only).
9. **Draft resume via magic link** (emailed token) instead of a full anonymous-auth system; or require email first, then a signed resume URL. Skip "allow multiple draft submissions" nuance — allow exactly one draft per email per form.
10. **Cross-field character limits** are [NICE]: implement only if cheap (same evaluator pattern); otherwise per-field limits satisfy the brief.
11. **Notifications**: implement Submission Confirmation (must-have) with one templated email + merge tags; admin alerts (nice-to-have) as a single recipients list and plain default templates; skip per-form template versioning.
12. **Form list polish**: search/sort/tabs can be client-side over one fetched list (few forms per event); "Most Pending" sort optional.
13. **No autosave-on-keystroke in the builder** — explicit Save per step + optimistic-concurrency check is enough and far less bug-prone for parallel agents.
14. **Success-page redirect**: implement toggle + message + Continue button; the 10-s auto-redirect is a one-liner but the Continue path is the tested one.
15. **Publish = Open**: skip a separate draft/published form state machine; a form with a public link is open until close date or manual close toggle.
