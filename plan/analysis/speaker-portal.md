# Feature Analysis: Speaker Portal (post-submission), Tasks, and Portal Forms

Assigned area: the self-service speaker portal (what a speaker sees after submitting a CFP),
the Tasks system (organizer-defined tasks speakers complete after admission), and Portal > Forms
(forms attached to tasks that speakers fill out), plus Portal > File Requests (upload tasks).

Brief anchors (primary features this area covers):
- "Self-service speaker portal for bios, headshots, slides, and supporting documents" [CORE]
- "Real-time dashboard showing which speakers still have outstanding onboarding tasks" [optional-but-nice per brief; the *speaker-side* task list and completion states are the data source for it]
- "Resource and wiki pages within the speaker portal, including HTML embed support" [CORE — Resources nav item appears in these screenshots; page content itself is another agent's area]
- Portal > Tasks / Portal > Forms are explicitly called out in the requirements screenshot index ("Speaker portal after submission", "Portal > Tasks — For speakers to complete after admission", "Portal > Forms — For speakers to fill out a form in a Task").

---

## What the screenshots show — per screenshot

### 1. `100002010000080000000576C264887548D706C7.png` — Speaker portal HOME (speaker-facing)
- Top-right: avatar chip "SY" + name "Sw yx" with dropdown caret (account menu).
- Page title: **Home**.
- Horizontal portal nav (pill buttons, active = outlined blue): **Home** (active), **Submissions**, **Profile**, **Tasks**. Each has an icon (house, calendar, person, briefcase).
- Card **"My Submissions (2)"** (blue header bar with calendar icon) with a **"View All"** link in the header. Contains one card per submission:
  - "SESS-4 – sd" / type label "Featured Keynote" / status chip **Accepted** (green circled check).
  - "SESS-3 – ;lkj" / type label "Keynote" / status chip **Pending** (orange open circle).
  - Note the submission code pattern `SESS-<n>` + title, a session-type/track label, and a colored status.
- Card **"My Profile"** (blue header, person icon): avatar initials "SY", display name "Sw yx", email "swyx@ai.engineer", **"View more"** link (goes to Profile tab).
- Full-width card **"Tasks"** (blue header, briefcase icon):
  - Sub-tabs: **All** (active), **My Tasks (0)**, **Submissions (0)** — i.e. tasks are grouped by whether they target the contact (person) or one of their submissions/sessions, with per-tab counts.
  - Right side: **Filter** dropdown control with funnel icon.
  - Section **"Submission Tasks"** with (i) info tooltip icon, and header actions **"Open All"** / **"Collapse All"** (accordion behavior). Empty state text: *"No submission tasks found."*
  - Section **"My Tasks"** with (i) info icon. Empty state (cut off): *"No tasks found"*.
- Takeaway: the speaker home is a 3-widget dashboard — submissions with statuses, profile summary, and a task list split into contact-level vs submission-level tasks, each with empty states.

### 2. `10000201000008000000059BDA082D949FA28A6E.png` — Speaker portal PROFILE edit (speaker-facing)
- Same portal nav; **Profile** active. Red annotation: "update your own bio data".
- Account dropdown (open, top right): shows name + email, menu items **Profile**, **Back to Admin Mode**, **Logout**. ("Back to Admin Mode" = organizer is impersonating/previewing a speaker — an admin "view as portal user" mode exists.)
- Header block: large avatar (initials "Sy"), name, email.
- Tab chip: **Profile Info** (single tab visible).
- Card **General** (collapsible, chevron):
  - **Biography** — rich text editor with toolbar: Bold, Italic, Underline, bulleted list, numbered list, align left/center/right, hyperlink, clear formatting. Placeholder "Enter text here...". Character counter **"0 / 5,000 characters"**.
  - **Salutation** (text input with a red overflow/menu icon), **First Name** (prefilled "Sw"), **Last Name** (prefilled "yx").
  - **Honorific** (text), **Pronouns** (Select dropdown), **Gender** (Select dropdown).
  - (Card scrolls further; headshot upload is implied by the avatar + brief's "bios, headshots".)
- Card **My Links** (collapsible): **LinkedIn URL**, **X (Twitter) URL**, **Facebook URL**, **Website** — four plain URL inputs.
- Takeaway: profile = bio rich text w/ char limit, name/salutation/honorific/pronouns/gender, social links, avatar/headshot; saved by the speaker themselves.

### 3. `10000201000008000000057761A531FDC681A025.png` — Admin **Portals > Tasks** list (organizer-facing)
- Admin chrome: left sidebar with event switcher "AI.Engineer Sand… Oct 12–14, 2026"; sections: SUBMISSIONS (View All, Abstracts, Sessions, Files), COLLECT & REVIEW (Forms, Evaluation, Agenda, Invoices, Site), PORTALS (**Portals, Tasks** [active], **Forms, File Requests, Resources, Files**), CONFIGURE (Settings); bottom-level nav CRM, Marketing, CMS. Top bar: "Find or ask" command palette (⌘K), **View Portal** button, notification megaphone, help, avatar.
- Page title: **Tasks** — subtitle *"Create tasks that can be assigned to your portals"*.
- Top-right **+ Add** split button; open menu shows **Add Task** (highlighted, red arrow annotation) and **Copy from…** (copy tasks from another event).
- Search input: "Search tasks…".
- Tabs with counts: **All Tasks (3)** [active], **Contact Tasks (1)**, **Group Tasks (0)**, **Submission Tasks (2)** — tasks are typed by their target: Contact / Group (sponsors-exhibitors) / Submission.
- Task rows (cards), each with a kebab (…) menu:
  - **"Hotel and Travel Reservations"** + gray chip **Manual** ; meta row: "ssign up" (truncated description text) + person icon **Contact** (target type).
  - **"Presentation Upload"** + chip **Manual** ; meta row: calendar icon **Session** (target type).
  - **"add oil"** + chip **Manual** ; meta: "add" + calendar icon **Session**.
- Takeaway: a Task has name, description, a completion mode chip (**Manual** — i.e. speaker marks complete manually; the alternative implied is auto-completion by an attached Form or File Request), and a target type (Contact vs Session/Submission vs Group).

### 4. `1000020100000800000005936BA2420E98F58F5C.png` — Admin **Portals > Forms** list, empty (organizer-facing)
- Same admin chrome, **Forms** (under PORTALS) active.
- Page title **Forms** — subtitle *"Create forms that can be assigned to your portals to collect information"*.
- **+ Add** button (top right).
- Tabs with counts: **All Forms (0)** [active], **Contact Forms (0)**, **Group Forms (0)**, **Submission Forms (0)** — same 3-way target typing as tasks.
- Dashed-border empty state: icon, **"No forms yet"**, *"Create a form to collect information from participants"*.
- Takeaway: portal Forms are distinct from CFP submission forms; same target-type taxonomy; expect an empty-state design.

### 5. `1000020100000800000005944E8C812F7ECB2F27.png` — Admin **Create Form** wizard, step 1 "Form Setup"
- Header: **Create Form** with a disabled/primary **Create** (save) button top-right.
- Left stepper: **← Back to forms**; "FORM SETUP" list of 3 steps: **Form Setup** ("Name, module, and welcome …", active/dark), **Form Questions** ("Questions and section headin…", locked), **Settings** ("Deadlines, login, reminders, a…", locked).
- Main pane: **Form Setup** — *"Give your form an internal name, public title, and select what kind of form you want to build."*
  - **Name*** (internal) — placeholder "e.g. Speaker Contact Form".
  - **Title*** (public) — placeholder "e.g. Add A Contact To Manage Your Portal".
  - **Type** — 3 selectable cards: **Contacts** ("Collect contact information from people"), **Groups** ("Collect information from sponsors and exhibitors"), **Submissions** ("Collect submission-related information").
- Footer: **Back** (disabled), helper text *"Complete all required fields on this step to continue."*, **Next** button.
- Takeaway: form builder = 3-step wizard (Setup → Questions → Settings); forms have internal name vs public title; type drives what entity answers attach to.

### 6. `100002010000080000000581E6B6DAA25607254F.png` — Admin **Edit Form** step 2 "Form Questions"
- Header: **Edit Form / kh** with **Duplicate**, **Delete** (red), **Save** buttons.
- Stepper: Form Setup (checked), **Form Questions** (active), Settings (pending).
- Main: **Form Questions** — *"Add and arrange the fields participants will fill out."*
- Section card:
  - **Section Title*** input (value "Update Your Information").
  - **Description & Instructions** rich-text editor (toolbar: B, I, U, superscript, subscript, link, bulleted list, numbered list, outdent, indent; status bar shows "p"). Value: "Please add or update your information below."
- Open **Add** popover (anchored from an add button): items **Add Section Element ›** (submenu) and **Create Field**; below, a **"Search fields…"** search box over a library of *existing/standard fields* with type chips:
  - **Client Session ID** — `text`
  - **Description** — `wysiwyg`
  - **Format** — `dropdown`
  - **Language** — `dropdown`
  - **Level** — `dropdown`
  - **Tags** — `dropdown`
  - (list scrolls — these are standard Session fields, meaning form answers can map onto session/contact record fields.)
- **Form Questions** card: **+ Add Field** button; one existing question row: drag handle (⋮⋮), **Title*** (red asterisk), sub-label `Text` (field type), right side: **Required** toggle (on), a **lock icon** (field locked/system), kebab menu.
- Footer: **Back** / **Next**.
- Takeaway: portal form builder supports sections (title + rich-text description), a standard-field library mapped to record fields plus custom "Create Field", per-question required toggle, drag-to-reorder, locked system fields, duplicate/delete of whole forms.

### 7. `100002010000080000000585739665179B3B4675.png` — Admin **Edit Form** step 3 "Settings"
- URL visible: `appv2.sessionboard.com/event/6703/portals/forms/<uuid>` (portal forms live under an event; UUID ids).
- Header: **Edit Form / kh**, **Duplicate**, **Delete**, **Save**.
- Stepper: Form Setup ✓, Form Questions ✓, **Settings** active ("Deadlines, login, reminders, a…" — so full product has deadline + reminder settings here).
- Main: **Form Settings**:
  - **Send Confirmation Email** toggle (on) — *"Submitters will receive an email with a link to access their submission in the portal."*
  - Rich-text editor for the confirmation email body (toolbar incl. B/I/U, super/subscript, link, lists, indent/outdent, alignment, image, overflow "…"). Body: "Thank you for submitting your form. Here is a link to your submission."
- Bottom-right toast: **"Saved successfully — Your changes have been saved."** with **View All Forms** button.
- Takeaway: per-form confirmation email w/ editable rich-text template; settings step also covers deadlines/login/reminders (truncated label); save confirmation toast pattern.

### 8. `10000201000008000000057E9D9EF45A436CE966.png` — Admin **Portals > File Requests** list, empty
- **File Requests** active in sidebar.
- Page title **File Requests** — subtitle: *"Collect files (e.g. documents, contracts) from your portals. Uploaded files are stored here for download or export — they are not attached to a submission or contact record."*
- **+ Add** button.
- Tabs with counts: **All Requests (0)**, **Contact Requests (0)**, **Group Requests (0)**, **Submission Requests (0)**.
- Dashed empty state: **"No file requests yet"** / *"Create a file request to collect documents from participants"*.
- Takeaway: third portal collection primitive = File Request; same target typing; explicit note that files are stored on the request (downloadable/exportable), not attached to records.

### 9. `10000201000008000000058AA747261FA401FE54.png` — Admin **Add File Request** drawer
- Right-side drawer: **Add File Request** — *"Create a new file request for participants"*, close (X).
- Info callout: **"Files are stored, not attached"** — *"Uploaded files live on this File Request and can be downloaded or exported. They are not attached to the contact, group, or session record."*
- **Title** input — placeholder "e.g. Upload Presentation Slides".
- **Type*** — 3 cards: **Contacts** (selected, outlined), **Groups**, **Submissions**.
- **Instructions** — rich-text editor (B, I, U, lists, alignment, link, clear formatting), placeholder "Enter instructions…".
- Footer: **Cancel** / **Create File Request** (primary).
- Takeaway: file request = title + type + rich-text instructions; creation via drawer (not wizard).

---

## Required capabilities

Numbered functional requirements for a good-enough clone. [CORE] = in the brief's primary features; [NICE] = visible/inferred but not demanded.

### Speaker portal shell & auth
1. [CORE] Speaker portal at a distinct route namespace (e.g. `/portal/[eventSlug]`) with nav: Home, Submissions, Profile, Tasks (+ Resources per the resources/wiki primary feature). Mobile-friendly.
2. [CORE] Speaker authentication via magic link (email token) — the confirmation email says "link to access their submission in the portal"; passwordless magic-link is the simplest faithful model. Session persists; Logout in account menu.
3. [NICE] Organizer "View Portal" / impersonation: admin can open the portal as a given speaker ("Back to Admin Mode" menu item). Extremely useful for demo/judging; low cost if auth supports an impersonation cookie.
4. [CORE] Portal Home dashboard: My Submissions widget (count, per-submission code/title/type/status chip, View All), My Profile widget (avatar, name, email, View more), Tasks widget (tabbed All / My Tasks (n) / Submissions (n), grouped sections with Open All/Collapse All, per-group empty states).

### Submissions view (speaker-side, post-submission)
5. [CORE] Speaker sees each of their submissions with: human code (`SESS-n`), title, session type/track label, and status (at minimum Pending / Accepted / Declined; Waitlist optional) with color-coded chips.
6. [NICE] Speaker can open a submission to view (and, if the organizer allows, edit) their answers; at minimum a read-only detail view.
7. [CORE] Status changes made by organizers (accept/decline in evaluation area) are reflected in the portal immediately (server-rendered or TanStack Query refetch).

### Profile (bios & headshots)
8. [CORE] Speaker-editable profile: Biography rich text (with 5,000-char counter/limit), First/Last name, Salutation, Honorific, Pronouns (select), Gender (select), and links: LinkedIn, X/Twitter, Facebook, Website.
9. [CORE] Headshot upload on the profile (image file, preview as avatar, replace/remove). Stored in object storage (Cloudflare R2 fits the Cloudflare bonus).
10. [CORE] Profile data feeds the public speaker gallery (another agent's area) — so profile fields must live on a shared Speaker/Contact entity, not a portal-private table.
11. [NICE] Collapsible card sections (General / My Links) and autosave-or-explicit-Save with a "Saved successfully" toast.

### Tasks (organizer-defined, speaker-completed)
12. [CORE] Organizer CRUD for Tasks: name, rich-text description/instructions, target type (**Contact** or **Submission**; Group may be omitted — see Simplifications), due date, and completion mode. Admin list has search, tabs by target type with counts, kebab actions (edit, delete), and an Add menu.
13. [CORE] Task kinds / completion modes (this is the heart of the area):
    a. **Manual** task — speaker reads instructions and clicks "Mark complete" (the `Manual` chip in screenshot 3).
    b. **Form** task — a Portal Form is attached; task completes when the speaker submits the form (Portal > Forms "for speakers to fill out a form in a Task").
    c. **File Request** task — a File Request is attached; task completes when the speaker uploads the requested file(s) (e.g. "Presentation Upload" → slides).
14. [CORE] Task assignment: contact tasks apply to all portal contacts (speakers) — or an explicit audience; submission tasks apply per accepted submission/session (so a speaker with 2 accepted sessions sees the task twice, once per session, each tracked separately).
15. [CORE] Speaker task list: shows each task with title, description, due date, status (Open/To-do → Completed; Overdue derived from due date), grouped into "My Tasks" (contact-level) and "Submission Tasks" (grouped per submission, collapsible), with counts in tab labels and filter (e.g. by status).
16. [CORE] Completion tracking is per (task × assignee[ × submission]) — a TaskAssignment/TaskCompletion row with status + completedAt — because the organizer dashboard ("which speakers still have outstanding onboarding tasks") reads exactly this table.
17. [CORE] Real-time-ish organizer dashboard of outstanding tasks per speaker (the brief's primary feature #6): % complete per speaker, counts of open/overdue tasks; polling/refetch is acceptable ("real-time" ≠ websockets for this judging).
18. [NICE] "Copy from…" (clone tasks from another event) — skip; single-event demo.
19. [NICE] Task reminders via the communications module (another area) — expose `dueDate` + completion status so the email module can query "incomplete tasks due in X days".

### Portal Forms (form attached to a task)
20. [CORE] Organizer form builder for portal forms, 3-step wizard: Setup (internal Name*, public Title*, Type: Contact/Submission), Questions, Settings.
21. [CORE] Questions step: ordered sections (Section Title* + rich-text Description & Instructions) containing ordered fields; per-field: label, type, required toggle, options (for selects); drag-to-reorder; add via (a) standard-field library (fields mapped to contact/session record columns, searchable, showing type chips like text/wysiwyg/dropdown) and (b) "Create Field" custom fields. A lock marker for non-removable system fields is [NICE].
22. [CORE] Field types minimum: short text, long text/wysiwyg (textarea is fine), dropdown/select, checkbox/multi-select, email, URL, date, file upload. (The CFP submission-form builder in another area needs conditional logic; portal forms do NOT show conditional logic — plain linear forms suffice here. Ideally both reuse one form-schema module.)
23. [CORE] Speaker-side form fill UX: the task detail opens the attached form rendered from its schema; client-side + server-side validation of required fields; submit persists a FormResponse keyed to (form, contact[, submission]) and marks the linked task complete.
24. [CORE] Standard-field mapping: answers to library fields (e.g. Bio, Title, Level, Tags) write back to the underlying contact/session record on submit — this is what makes "Update Your Information" forms update the actual speaker record. (Keep the mapping table small; see Simplifications.)
25. [NICE] Form Settings step: **Send Confirmation Email** toggle + rich-text email body (with portal link merge). Deadlines/reminders/login toggles visible in the truncated label are [NICE].
26. [NICE] Duplicate form; Delete form (with confirm); "Saved successfully" toast with "View All Forms" action.
27. [NICE] Organizer view of collected responses per form (table of respondents + answers, CSV export). Not in screenshots but obviously needed for the product to be usable; mark as strongly-recommended NICE.

### File Requests / uploads (slides & supporting documents)
28. [CORE] Organizer CRUD for File Requests via drawer: Title, Type (Contact/Submission), rich-text Instructions.
29. [CORE] Speaker-side upload: from the task (or a Files area), upload one or more files (pdf/ppt/pptx/key/zip/images), see uploaded file name/size/date, re-upload/replace, download own file. Store in R2; validate size (e.g. ≤ 50–100 MB) and extension.
30. [CORE] Organizer-side: list uploads per file request (who, file, when), download individual files; "export/download all" is [NICE]. Per the product's own note, uploads attach to the FileRequest (join to contact/submission for attribution), not to the record itself.
31. [CORE] Uploading against a file-request task marks that task's assignment complete (auto-complete on first upload).

### Cross-cutting
32. [CORE] All portal reads/writes scoped by event + authenticated contact; a speaker can never see another speaker's tasks/responses/files (IDOR-proof: every query filters by session's contactId).
33. [NICE] Public API endpoints for tasks/completion status (feeds the API bonus points), e.g. `GET /api/v1/events/:id/speakers/:id/tasks`.
34. [NICE] Airtable one-way export includes speakers (profiles), tasks, and task-assignment status rows so organizers can see onboarding progress in Airtable.

---

## Data entities

(Names indicative; all rows carry `event_id` for scoping and `created_at`/`updated_at`.)

- **Contact (Speaker)** — the person. Fields: email (unique per event), first_name, last_name, salutation, honorific, pronouns, gender, bio_richtext (≤5000 chars), headshot_url, linkedin_url, twitter_url, facebook_url, website_url. Relationships: has many Submissions (via SubmissionSpeaker), TaskAssignments, FormResponses, FileUploads, PortalSessions. Shared with CFP + gallery areas.
- **Submission (Session/Abstract)** — code (`SESS-n`, per-event sequence), title, session_type/track, status enum (`pending|accepted|declined|waitlist`), owning contact + co-speakers. Owned by the CFP/review area; portal reads it and hangs submission-scoped tasks off it.
- **PortalTask** — name, description_richtext, target_type enum (`contact|submission`), completion_mode enum (`manual|form|file_request`), form_id?, file_request_id?, due_at (timestamptz, nullable), audience (default: all admitted speakers / all accepted submissions), is_active. Constraint: exactly one of form_id/file_request_id when mode ≠ manual.
- **TaskAssignment** — task_id, contact_id, submission_id (nullable; set iff task.target_type = submission), status enum (`open|completed`), completed_at, completed_via (`manual|form_response|file_upload`). Unique (task_id, contact_id, submission_id). This table IS the onboarding dashboard's source of truth; `overdue` is derived (status=open AND due_at < now()).
- **PortalForm** — internal_name, public_title, target_type (`contact|submission`), status (`draft|published`), settings jsonb: { send_confirmation_email: bool, confirmation_email_body_richtext }.
- **FormSection** — form_id, title, description_richtext, sort_order.
- **FormField** — section_id, label, field_type enum (`text|textarea|richtext|select|multiselect|checkbox|email|url|date|file`), required bool, options jsonb (for selects), sort_order, is_locked bool, maps_to (nullable enum/string identifying a Contact or Submission column, e.g. `contact.bio`, `submission.title`) — the standard-field library is just the set of predefined (label, field_type, maps_to) triples.
- **FormResponse** — form_id, contact_id, submission_id?, task_assignment_id?, answers jsonb ({field_id: value}), submitted_at. One response per (form, contact[, submission]) unless resubmission allowed.
- **FileRequest** — title, target_type (`contact|submission`), instructions_richtext.
- **FileUpload** — file_request_id, contact_id, submission_id?, task_assignment_id?, file_name, mime_type, size_bytes, storage_key (R2), uploaded_at.
- **PortalAuthToken / PortalSession** — magic-link token (hashed, expiring, single-use) → session cookie binding contact_id + event_id; impersonation flag for admin preview.
- (Referenced from other areas: **Event**, **ResourcePage** (portal wiki), **EmailMessage** (confirmation/reminders), **Review/Evaluation** feed the Submission.status the portal displays.)

Key relationships: Task 1—n TaskAssignment n—1 Contact; TaskAssignment n—1 Submission (optional); Task n—1 PortalForm / FileRequest (optional); FormResponse & FileUpload point back to TaskAssignment so completion is auditable.

---

## User flows

### Speaker
1. **First entry**: receives email (CFP confirmation or acceptance/onboarding email) → clicks magic link → token validated → portal session cookie set → lands on Portal Home showing My Submissions (with statuses), My Profile, Tasks.
2. **Update profile**: Home → Profile (or "View more") → edits Bio (rich text, counter), names, pronouns/gender selects, social links → uploads headshot (file picker → preview → save) → Save → "Saved successfully" toast. Gallery reflects changes.
3. **Check submissions**: Home → Submissions → list of their submissions with code/type/status chips → open one → read-only detail of submitted answers.
4. **Complete a manual task** (e.g. "Hotel and Travel Reservations"): Tasks tab → "My Tasks" group → open task → read rich-text instructions → click "Mark as complete" → status flips to Completed, moves out of outstanding counts.
5. **Complete a form task** (e.g. "Update Your Information"): Tasks → open task → embedded/linked form renders sections + fields (prefilled from mapped record fields where applicable) → fill, client validation on required → Submit → FormResponse saved, mapped answers written back to contact/submission record, task auto-completed → optional confirmation email sent → success state.
6. **Complete an upload task** (e.g. "Presentation Upload" on a specific session): Tasks → "Submission Tasks" → group for SESS-4 → open task → read instructions → drag/drop or pick file → progress → uploaded file listed (name/size/date, replace/delete) → task auto-completed on first successful upload.
7. **Ongoing**: revisits portal via same magic link/session; sees Overdue badges on tasks past due date; Logout via avatar menu.

### Organizer (admin)
1. **Create a task**: Portals > Tasks → + Add → Add Task → name, description, target type (Contact vs Submission), completion mode; if Form/File Request mode, pick or create the attached object; set due date → save → task appears in the typed tab with count.
2. **Create a portal form**: Portals > Forms → + Add → wizard: Setup (name, title, type) → Next → Questions (add section w/ title + instructions; Add Field → pick from standard library (search, type chips) or Create Field; toggle Required; drag to reorder) → Next → Settings (confirmation-email toggle + body) → Save → toast; can Duplicate/Delete later.
3. **Create a file request**: Portals > File Requests → + Add → drawer: title, type, instructions → Create File Request.
4. **Attach & assign**: link form/file request to a task; assignments materialize for every admitted speaker (contact tasks) or accepted submission (submission tasks) — including speakers admitted *after* the task was created.
5. **Monitor**: Dashboard (optional area) shows per-speaker outstanding/overdue task counts fed by TaskAssignment; organizer drills into a form's responses or a file request's uploads and downloads files.
6. **Preview as speaker**: "View Portal" → portal opens (optionally impersonating a chosen contact) → "Back to Admin Mode" returns.

### Reviewer
- No direct role in this area. Reviewer decisions (accept/decline) in the evaluation area flip Submission.status, which (a) changes the status chip the speaker sees and (b) triggers materialization of onboarding TaskAssignments for newly-accepted speakers/submissions.

### Public visitor
- No access to the portal (auth-gated). Sees only downstream artifacts: speaker gallery/schedule built from profile fields (bio, headshot) that speakers maintain here. Magic-link URLs must be unguessable and expiring.

---

## Edge cases & bug traps

1. **Per-submission task fan-out**: a submission-type task must create one assignment per (accepted) submission, not per speaker. Speaker with 2 accepted sessions sees "Presentation Upload" twice; completing one must not complete the other. Naive unique key on (task_id, contact_id) breaks this — include submission_id.
2. **Late admits**: speakers accepted after a task exists must still get assignments. Either materialize on acceptance (event/trigger) or compute assignments lazily (view over tasks × accepted submissions) — lazy is simpler and can't miss anyone; then completion rows are written only on completion (assignment = task × target, status derived from existence of completion row).
3. **Co-speakers**: if a submission has multiple speakers, decide who owns its tasks (simplest: primary contact only; document it). Otherwise the dashboard double-counts.
4. **Task edited after completions exist**: switching a task's completion mode (manual → form) or its attached form must not orphan/reset completions silently; simplest rule = lock target_type & mode once any assignment is completed.
5. **Form ↔ record write-back races**: an "Update Your Information" form and the Profile page edit the same contact row. Last-write-wins is acceptable, but write back only fields present in the form, never a whole-row overwrite (a stale form submit would clobber a fresher profile edit).
6. **Duplicate form submissions**: double-click on Submit / retried POST must not create two FormResponses or double-complete the task — unique constraint on (form_id, contact_id, submission_id) + idempotent upsert; completion marking must be idempotent (`ON CONFLICT DO NOTHING`).
7. **Required-field validation drift**: validate against the *server's* copy of the form schema at submit time, not the client's — the organizer may have edited the form between page load and submit. Reject with a re-render rather than 500 on unknown field ids.
8. **Answers stored by field_id vs label**: store by immutable field_id; labels get renamed. Deleting a field with existing answers: soft-delete/hide, keep answers readable.
9. **Timezones on due dates**: store `due_at` as timestamptz; "Overdue" must compare in UTC server-side, display in the viewer's locale/zone (event TZ for admin views). A date-only due field naively parsed as local midnight will show Overdue a day early/late for someone in another TZ — pick end-of-day in the event's timezone if only a date is collected.
10. **Empty states everywhere**: screenshots show four distinct empty states (no submission tasks / no tasks / no forms yet / no file requests yet). Zero-count tabs must render counts "0", not hide tabs. Portal Home with zero submissions must not crash the widgets.
11. **Bio 5,000-char limit**: enforce on both rich-text plaintext length (client counter) and server; decide whether HTML markup counts (count plaintext; sanitize HTML server-side — the rich text is later rendered in public gallery pages, so XSS-sanitization is mandatory).
12. **Rich text rendering**: task descriptions, form section instructions, file-request instructions, and confirmation-email bodies are all rich text authored by organizers — sanitize on save and render with a whitelist; don't `dangerouslySetInnerHTML` raw.
13. **File upload traps**: size limits (Workers request body limits — use presigned R2 upload URLs from the client rather than proxying bytes through the Worker), MIME/extension whitelist, filename sanitization (unicode, path separators), duplicate uploads (replace vs versioned list — keep all, show latest), orphan cleanup if the DB row write fails after upload, and download authorization (signed URLs, never public bucket paths).
14. **Auto-complete ordering**: mark task complete only after FormResponse/FileUpload commit succeeds (same transaction where possible); an upload that fails post-completion would show a "completed" task with no file.
15. **Magic-link auth traps**: tokens must be single-use-ish, expiring, hashed at rest; link opened in a different browser than expected (email scanners prefetch links — GET must not consume the token; confirm with a POST/click). Session must bind to (contact, event); a speaker in two events needs separate scoping.
16. **Impersonation leaks**: "Back to Admin Mode" implies admin sessions swap into speaker context — ensure impersonated writes are attributed and admin cookie isn't lost; simplest is a read-write impersonation but never let an unauthenticated portal route fall back to admin identity.
17. **Status chip source of truth**: portal shows Pending/Accepted; TanStack Query caches must invalidate on window focus or short staleTime, or a just-accepted speaker sees stale "Pending" and — worse — no onboarding tasks.
18. **Counts consistency**: tab counts (My Tasks (0), Submissions (2), All Tasks (3)) must come from the same query as the lists or they drift; compute counts from the fetched dataset client-side where feasible.
19. **Concurrent form-builder edits**: two admin tabs editing one form — last save wins is fine, but reordering by fractional sort keys or full-array rewrite must not interleave into duplicate sort_order values that render nondeterministically.
20. **Deleting a form/file request referenced by a task**: block delete or cascade to detach + revert task to manual with a warning; a dangling form_id will 500 the speaker's task page.

---

## Simplifications

Safe cuts that keep the brief's intent ("good-enough clone", judged on daily usability):

1. **Drop Group (sponsor/exhibitor) targets entirely.** Every tabbed taxonomy becomes Contact | Submission. The brief is speakers-only; keep the enum extensible.
2. **Merge Forms + File Requests into the Task model as three task kinds** (`manual | form | file_upload`) instead of three separate admin modules with cross-linking. Admin UI: one "Tasks" page where creating a task of kind=form opens the form builder, kind=file_upload asks title/instructions/accepted-types. This collapses 3 nav items into 1 with zero loss of speaker-facing capability. (Optionally keep read-only "Forms" and "File Requests" filtered views of the same data to mirror Sessionboard's nav.)
3. **No 3-step wizard** — a single form-builder page (setup fields at top, questions below, settings collapsed) with one Save. Keep internal name vs public title.
4. **Standard-field library minimal**: hardcode ~8 mappable fields (bio, headshot, pronouns, tagline/title, company, session title, session description, session level/tags) instead of Sessionboard's full record-field catalog. Custom fields cover the rest via jsonb answers with no write-back.
5. **Skip conditional logic on portal forms** (screenshots show none here; conditional logic lives in the CFP submission-form area) — but share one FormSchema/renderer module between CFP forms and portal forms so the logic exists once and portal forms simply don't use branching.
6. **One response per form per target; allow resubmit = overwrite** (upsert). No versioned response history.
7. **Manual completion is a single button** — no partial progress, no organizer "reopen" beyond flipping the status back in admin (one mutation).
8. **Confirmation email**: implement the toggle + a fixed-merge template (greeting + organizer body + portal link) via the shared email module; skip per-form reminder scheduling — global task-reminder emails belong to the communications area keyed off due_at.
9. **"Real-time" dashboard = TanStack Query polling (10–30s) / refetch-on-focus** over a single aggregate SQL view (speaker, open_count, overdue_count, done_count). No websockets/SSE.
10. **Rich text**: one small editor component (e.g. TipTap starter-kit subset matching the toolbars seen: B/I/U, lists, alignment, link) reused for bio, task descriptions, section instructions, file-request instructions, email body. Store sanitized HTML. Skip superscript/subscript/image-embed niceties.
11. **Skip**: "Copy from…" cross-event cloning, per-field lock icons, salutation/honorific quick-insert widget, invoices, CRM/Marketing/CMS sidebar surfaces, command palette. Single event assumption acceptable (schema still carries event_id).
12. **Uploads**: direct-to-R2 presigned PUT + a metadata row; no virus scanning, no export-all-zip (list + individual downloads suffice for judging; add zip only if time remains).
13. **Impersonation**: implement as "open portal as contact X" signed link from admin (read/write, banner shown) — 30 lines, huge demo value; skip full session-swap plumbing.

Module-boundary note for parallel agents: this area exposes four typed contracts other agents consume — (1) `Contact` profile shape (gallery agent reads bio/headshot/links), (2) `Submission.status` (read-only here; written by evaluation agent), (3) `TaskAssignment` aggregate view (dashboard agent), (4) `FormSchema`/`FormRenderer` shared with the CFP-forms agent. Define these as zod schemas in `src/shared/contracts` first; this repository is not a package workspace.
