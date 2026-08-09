# M02 — Shared contracts

| | |
|---|---|
| **Status** | IN PROGRESS — **MERGED**, AC sign-off pending. PR #9 landed the complete contract surface (branded ids, single-source enums, DTOs, submission transitions, error envelopes, idempotency recipes, the fan-out law, and the golden form-snapshot fixture). Remaining before `DONE`: work-order AC sign-off against the merged tree and the CP1 freeze declaration in `DECISIONS.md`. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-A Platform & Foundation (architect) |
| **Scheduled** | Fri Aug 8 evening (draft circulated at CP0) → complete and **FROZEN at CP1, Sat noon** |
| **Size** | M |
| **Paths owned** | `src/shared/contracts/**`, `src/shared/fixtures/*.ts` (the Phase-0 set only: `form-snapshot.ts`, `contacts.ts`, `submissions.ts`, `sessions.ts`, `tasks.ts`, `comm-log.ts`, `outstanding-tasks.ts`); plus a **one-time create** of every feature barrel `src/features/<f>/index.ts` (the Phase-0 stub drop, §11) whose ownership transfers to that feature's workstream the moment its agent starts. **Lane-local fixtures created after CP1 live in `src/shared/fixtures/lanes/<ws>/*.ts`, owned by that lane and NOT covered by the CP1 freeze** — [M28](./M28-sessions-crud.md) (`lanes/ws-e/vocab.ts`, `lanes/ws-e/accepted-submissions.ts`), [M32](./M32-public-schedule-gallery.md) (`lanes/ws-e/event.ts`), [M30](./M30-day-grid-dnd.md) (`lanes/ws-e/sessions.ts`). ([M27](./M27-speakers-admin.md) needs no lane fixture — it consumes the Phase-0 `fixtures/comm-log.ts` shipped here.) |

## Objective
Every cross-agent type, enum, DTO, error code, idempotency recipe and function signature exists as compiling TypeScript before any feature agent starts. Seven agents can then build against typed interfaces and fixtures instead of against each other's unfinished code. When this lands, `pnpm typecheck` passes with every feature barrel present-but-throwing, the golden `FormSnapshot` fixture zod-parses, and the fan-out gate is open.

## Dependencies
- **Hard (blocks start):** [M01](./M01-scaffold-ci-deploy.md) — `tsconfig` with `@/*` alias, strict flags, and `zod` installed at the version resolution #5 settled.
- **Soft:** none. Contracts compile standalone by construction (`pnpm typecheck` on `src/shared/contracts` alone must pass with zero imports from `features/**` or `db/**`).

## Provides (interfaces others consume)
Everything is importable from `@/shared/contracts`. Consumers are named per file below; **every** module in the build consumes at least `enums.ts` and `ids.ts`.

| File | Exports | Consumed by |
|---|---|---|
| `ids.ts` | branded id schemas + types | all |
| `enums.ts` | const arrays + zod enums + TS unions | all |
| `transitions.ts` | `SUBMISSION_TRANSITIONS`, `canTransition` | [M17](./M17-abstracts-table.md), [M18](./M18-submission-mutations-notify.md), [M21](./M21-portal-shell.md), [M03](./M03-db-schema-migrations.md) (trigger parity test) |
| `forms.ts` | `FormSnapshot`, `Condition`, `VisibilityRule`, `RoutingRule`, `AnswerValue`, `CleanAnswers`, `MapsToTarget` | [M04](./M04-shared-libs.md), [M12](./M12-form-builder-core.md), [M13a](./M13a-condition-evaluator.md), [M15](./M15-public-cfp-wizard.md), [M16](./M16-submit-pipeline.md), [M24](./M24-portal-form-builder.md), [M25](./M25-task-runtime.md), [M41](./M41-speaker-edit-until-close.md) |
| `submission.ts` | `SubmissionListRow`, `CreateSubmissionInput`, `SubmissionDetailDTO`, `AcceptedForSchedulingRow` | [M16](./M16-submit-pipeline.md), [M17](./M17-abstracts-table.md), [M18](./M18-submission-mutations-notify.md), [M19](./M19-evaluation-scoring.md), [M20](./M20-csv-export.md), [M28](./M28-sessions-crud.md) |
| `speaker.ts` | `ContactDTO` (the published gallery DTOs live in `session.ts`) | [M21](./M21-portal-shell.md), [M22](./M22-speaker-profile.md), [M27](./M27-speakers-admin.md), [M39](./M39-airtable-export.md) |
| `session.ts` | `ScheduledSessionDTO`, `ConflictDTO`, `MySessionDTO`, `PublishedSessionDTO`, `PublishedScheduleDTO`, `PublishedSpeakerDTO`, `PublishedSpeakersDTO` | [M21](./M21-portal-shell.md), [M28](./M28-sessions-crud.md), [M29](./M29-conflict-engine.md), [M30](./M30-day-grid-dnd.md), [M31](./M31-agenda-views.md), [M32](./M32-public-schedule-gallery.md), [M33](./M33-embed-shells.md), [M35](./M35-ics-calendar-invites.md), [M40](./M40-public-api.md) |
| `task.ts` | `TaskDTO`, `TaskAssignmentDTO`, `OutstandingTasksRow` | [M23](./M23-tasks-admin.md), [M25](./M25-task-runtime.md), [M36](./M36-reminder-scan.md), [M38](./M38-dashboard.md) |
| `comms.ts` | `CommLogRow`, `CommLogDetail`, `TEMPLATE_VAR_SCHEMAS` | [M27](./M27-speakers-admin.md), [M34](./M34-comms-outbox-dispatcher.md), [M37](./M37-comms-admin-ui.md), [M40](./M40-public-api.md) |
| `jobs.ts` | `JobName`, `JobStats` | [M08](./M08-jobs-worker.md) (owns only `JobResult`/`defineJobRoute`), [M34](./M34-comms-outbox-dispatcher.md), [M36](./M36-reminder-scan.md), [M39](./M39-airtable-export.md) — **feature code must never import from `src/app/**`; that inverts the boundaries direction and is a CI failure** |
| `deeplinks.ts` | `SPEAKERS_DEEPLINK_PARAMS` | [M27](./M27-speakers-admin.md) (producer of the filtered list), [M38](./M38-dashboard.md) (consumer of the links) |
| `event.ts` | `EventDTO`, `TrackDTO`, `RoomDTO`, `SessionFormatDTO`, `TagDTO` | [M11](./M11-events-feature.md) and every consumer of vocab |
| `ui.ts` | `FormFieldRendererProps` | [M15](./M15-public-cfp-wizard.md) (producer), [M25](./M25-task-runtime.md) (consumer) |
| `errors.ts` | `APP_ERROR_CODES` const array + zod enum | [M04](./M04-shared-libs.md) (builds `AppError` on it), all handlers |
| `limits.ts` | `LIMITS`, `plainTextLength()` | [M11](./M11-events-feature.md), [M12](./M12-form-builder-core.md), [M15](./M15-public-cfp-wizard.md), [M22](./M22-speaker-profile.md) |
| `idempotency.ts` | the 7 key builders, including manual reminder and `portalLogin(eventId, contactId, tokenId)` | [M06b](./M06b-portal-auth.md), [M16](./M16-submit-pipeline.md), [M18](./M18-submission-mutations-notify.md), [M28](./M28-sessions-crud.md), [M34](./M34-comms-outbox-dispatcher.md), [M36](./M36-reminder-scan.md) |
| `fanout.ts` | `TASK_FANOUT_RULE` doc constant | [M23](./M23-tasks-admin.md), [M25](./M25-task-runtime.md), [M36](./M36-reminder-scan.md), [M38](./M38-dashboard.md) |
| `api.ts` | `{data, meta?}` / `{error:{code,message}}` envelopes | [M40](./M40-public-api.md), [M04](./M04-shared-libs.md) |
| `../fixtures/*.ts` | golden `FormSnapshot` + `GOLDEN_AUTHORING_ROWS`, DTO fixtures | [M15](./M15-public-cfp-wizard.md), [M25](./M25-task-runtime.md), [M21](./M21-portal-shell.md), [M27](./M27-speakers-admin.md), [M38](./M38-dashboard.md), [M09](./M09-seed-demo-script.md), [M04](./M04-shared-libs.md) |

## Step-by-step implementation

### 1. CONTRACT-FIRST SLICE — `ids.ts` + `enums.ts` first, pushed within the first hour
Nothing else in the repo can be typed until these exist. Push them before writing anything below.

`src/shared/contracts/ids.ts` — branded ids (R3), created **only** by schema parse:
```ts
export const eventIdSchema = z.string().uuid().brand<'EventId'>();
export type EventId = z.infer<typeof eventIdSchema>;
```
Full list: `EventId, UserId, ContactId, FormId, SectionId, FieldId, FormVersionId, SubmissionId, ParticipantId, AnswerId, TrackId, RoomId, FormatId, TagId, SessionId, TaskId, FileRequestId, FileId, PlanId, CriterionId, ReviewId, EmbedId, CommLogId, ApiKeyId, TokenId`.

`src/shared/contracts/enums.ts` — **one const array per enum**, feeding drizzle `pgEnum` ([M03](./M03-db-schema-migrations.md)), the zod schema, and the UI badge maps. Transcribe data-model.md §3.0 exactly:
```ts
export const SUBMISSION_STATUSES = ['draft','pending','accept_queue','decline_queue',
  'accepted','declined','withdrawn'] as const;
```
Also: `SUBMISSION_KINDS` (abstract, session) · `SUBMISSION_SOURCES` (cfp, manual, import) · `FORM_CONTEXTS` (cfp, portal) · `FORM_STATUSES` (draft, open, closed) · `FIELD_TYPES` (all 13 pgEnum values: text, textarea, richtext, dropdown, multiselect, radio, checkbox, email, phone, url, number, date, file) · `PARTICIPANT_ROLES` (speaker, co_speaker, moderator, panelist) · `CONFIRMATION_STATUSES` (unconfirmed, confirmed, declined) · `MEMBER_ROLES` (owner, organizer, reviewer) · `TASK_TARGETS` (contact, submission) · `TASK_MODES` (manual, form, file_request) · `COMPLETION_VIAS` (manual, form_response, file_upload, admin) · `SESSION_STATUSES` (draft, published) · `PLAN_STATUSES` (open, closed) · `EMBED_CONTENT_TYPES` (5) · `TEMPLATE_KEYS` (**8 keys**: submission_received, submission_accepted, submission_declined, task_assigned, task_reminder, schedule_assigned, schedule_changed, **portal_login**) · `COMM_STATUSES` (queued, sent, failed, skipped — there is **no** `sending` value; [M34](./M34-comms-outbox-dispatcher.md)'s dispatcher claims rows via `locked_until`, not a status flip) · `ICS_METHODS` (request, cancel) · `TOKEN_PURPOSES` (magic_link, ics_download, impersonation) · `FILE_KINDS` (logo, background, headshot, attachment, slide, upload).

**Committed-vs-extensible field types (PROPOSED reconciliation, binding once merged):** the pgEnum keeps all 13 values so it stays extensible without a migration, and contracts additionally export
```ts
export const COMMITTED_FIELD_TYPES = ['text','textarea','richtext','dropdown',
  'multiselect','email','url','file'] as const;   // PLAN §1's "8 committed"; "wysiwyg" == 'richtext'
```
The builder ([M12](./M12-form-builder-core.md)) and renderer ([M15](./M15-public-cfp-wizard.md)) offer **only** these 8. `radio`/`checkbox`/`phone`/`number`/`date` are pgEnum-legal but unbuilt (deferred post-CP4 COULD).
**The 8th template key, `portal_login`** (added so [M06b](./M06b-portal-auth.md)'s OTP / magic-link mail can go through the one outbox path — `magic_link` is **not** a `TemplateKey` and must appear nowhere): it is the one key whose token is minted at **enqueue** time by M06b, because the token *is* the payload being delivered. Document that as the single explicit exception to resolution #12, right next to the key. [M03](./M03-db-schema-migrations.md) adds it to the `template_key` pgEnum as an additive ★ delta; [M34](./M34-comms-outbox-dispatcher.md) ships its `DEFAULT_TEMPLATES` entry; [M37](./M37-comms-admin-ui.md) renders it in the template rail (8 rows, not 7).
- **Done when:** `pnpm typecheck` passes, `SUBMISSION_STATUSES.length === 7`, and `TEMPLATE_KEYS.length === 8`.

### 2. `transitions.ts` — the state machine as data (R5)
```ts
export const SUBMISSION_TRANSITIONS: Record<SubmissionStatus, readonly SubmissionStatus[]> = {
  draft:         ['pending','withdrawn'],
  pending:       ['accept_queue','decline_queue','accepted','declined','withdrawn'],
  accept_queue:  ['pending','decline_queue','accepted','declined','withdrawn'],
  decline_queue: ['pending','accept_queue','accepted','declined','withdrawn'],
  accepted:      ['pending','accept_queue','decline_queue','declined','withdrawn'],
  declined:      ['pending','accept_queue','decline_queue','accepted'],
  withdrawn:     ['pending'],
};
export function canTransition(from: SubmissionStatus, to: SubmissionStatus): boolean;
export const FINAL_STATUSES = ['accepted','declined'] as const;  // leaving these bumps notify_revision
export const PORTAL_STATUS_LABEL: Record<SubmissionStatus, string>; // accept_queue/decline_queue → 'Pending'
```
This map **must be byte-identical to the plpgsql `trg_submission_status_guard` CASE** in `0001_views_triggers.sql`. Note that in a comment next to it.
- **Done when:** `transitions.test.ts` asserts the full 7×7 matrix, and [M03](./M03-db-schema-migrations.md)'s PGlite test proves every (from,to) pair agrees between `canTransition` and the DB trigger.

### 3. `forms.ts` — snapshot, conditions, routing, answers
- `FormSnapshot` verbatim from data-model.md §5.1: `{formId, version, context, sections: [{id, key, title, pageHeading, descriptionHtml, fields: [{id, key, label, type, required, locked, maxChars, helpText, options, visibility, mapsTo}]}]}`. Options: `{id, label, trackId?, formatId?, tagId?}`.
- `Condition` — **ops per resolution #10, and only these six**:
```ts
export const CONDITION_OPS = ['eq','neq','in','not_in','answered','empty'] as const;
export const conditionSchema = z.object({
  sourceFieldId: fieldIdSchema,
  op: z.enum(CONDITION_OPS),
  value: z.union([z.string(), z.array(z.string())]).optional(), // option IDs, never labels
});
```
  Add this doc comment verbatim next to it: *"There is no `contains` op. Multi-select 'contains option X' is expressed as `in` over option ids. The rule-editor UI copy ([M13b](./M13b-rules-ui.md)) says 'is any of' for `in`."*
- `visibilityRuleSchema` = `{match: 'all'|'any', conditions: conditionSchema.array().min(1).max(5)}`.
- `routingRuleSchema` = `{id, sortOrder, match, conditions, setTrackId?, addTagIds: TagId[], enabled}`.
- `AnswerValue` — discriminated union on `t` (data-model §5.4): `{t:'s',v:string}` (text/textarea/richtext/email/url) · `{t:'n',v:number}` · `{t:'d',v:'YYYY-MM-DD'}` · `{t:'opt',v:optionId}` · `{t:'opts',v:optionId[]}` · `{t:'file',v:FileId}`.
- `CleanAnswers` — the **participant-aware array** (a record cannot carry `participantId`, and [M16](./M16-submit-pipeline.md)/[M18](./M18-submission-mutations-notify.md) both need per-participant answers):
```ts
export const cleanAnswersSchema = z.array(z.object({
  fieldId: fieldIdSchema,
  participantId: z.string().nullable(),   // null = the abstract section
  value: answerValueSchema,
})).brand<'CleanAnswers'>();
export type CleanAnswers = z.infer<typeof cleanAnswersSchema>;
```
  **Only the [M16](./M16-submit-pipeline.md) pipeline can produce this brand**, so a repo insert that skips the pipeline does not typecheck (resolution #8's structural half). The **record** shape the evaluator works in is `Answers` (`Readonly<Record<FieldId, AnswerValue | undefined>>`, [M13a](./M13a-condition-evaluator.md)); the bridge between them is M13a's exported `cleanAnswersToRecord(clean, participantId = null): Answers` — the single conversion helper, referenced by [M16](./M16-submit-pipeline.md) Step 5 for `applyRouting`. There is no `cleanAnswersAsRecord`.
- `MAPS_TO_TARGETS` closed allowlist: `submission.title`, `submission.description_html`, `submission.track_id`, `submission.format_id`, `submission.level`, `submission.language`, `contact.first_name`, `contact.last_name`, `contact.email`, `contact.bio_html`, `contact.company`, `contact.job_title`, `contact.pronouns`, `contact.headshot_file_id`, `contact.linkedin_url`, `contact.twitter_url`, `contact.website_url`.
- **Done when:** the golden fixture (§10) parses against `formSnapshotSchema` in a test.

### 4. DTOs — one file per shared entity
- `event.ts`: `EventDTO` (id, name, slug, eventType, websiteUrl, location, timezone, startsAt, endsAt, theme, logoFileId, backgroundFileId, submissionCapPerUser, rowVersion), `TrackDTO` (id, name, color, description, sortOrder), `RoomDTO` (id, name, capacity, sortOrder), `SessionFormatDTO` (id, name, defaultDurationMins, sortOrder), `TagDTO`.
- `submission.ts` — **these three literals are the frozen versions; [M17](./M17-abstracts-table.md) and [M18](./M18-submission-mutations-notify.md) import them and never redeclare them.** `SubmissionListRow` is the exact M17 column set:
```ts
type SubmissionListRow = {
  submissionId: SubmissionId; code: number;                  // renders "SESS-{code}" via M18's formatCode(code)
  status: SubmissionStatus; source: 'cfp' | 'manual' | 'import';
  formId: FormId | null; formName: string | null;            // Source column shows formName ?? 'Manual'
  title: string; descriptionPlain: string | null;            // HTML stripped server-side for the cell
  submitterEmail: string | null; submitterName: string | null;
  speakers: Array<{ contactId: ContactId; name: string; isPrimary: boolean }>;
  trackId: TrackId | null; trackName: string | null; trackColor: string | null;
  tags: Array<{ id: TagId; name: string }>;
  rating: number | null; nScores: number;                    // from submission_ratings_v (active plan)
  notifiedAt: string | null; submittedAt: string | null; createdAt: string;
  formatName: string | null; language: string | null; level: string | null;
  capacity: number | null; clientSessionId: string | null;
  rowVersion: number;
};
type SubmissionDetailDTO = SubmissionListRow & {
  descriptionHtml: string | null; startsAt: string | null; endsAt: string | null;
  participants: Array<{ id: string; contactId: ContactId; name: string; email: string;
                        role: ParticipantRole; isPrimary: boolean; sortOrder: number }>;
  answerPanel: AnswerPanelData;                              // fed straight into <SubmissionAnswers>
};
type AcceptedForSchedulingRow = { submissionId: SubmissionId; code: number; title: string;
  descriptionHtml: string | null; trackId: TrackId | null; formatId: FormatId | null;
  alreadyPromoted: boolean;                                  // NOT `hasSession` — M28 filters on !alreadyPromoted
  speakers: Array<{ contactId: ContactId; name: string; role: ParticipantRole; isPrimary: boolean }> };
```
  `code` is a **number**; `formatCode(code)` ([M18](./M18-submission-mutations-notify.md) step 2) is the only renderer of the `"SESS-n"` string. **Every nullable is explicitly `| null`, never optional** — R10's `<Dash>` rule depends on it.
  `CreateSubmissionInput` — copy [M18](./M18-submission-mutations-notify.md)'s literal exactly; it is the canonical shape and every field is passed by a real caller:
```ts
type CreateSubmissionInput = {
  formId: FormId | null; formVersion: number | null;
  source: 'cfp' | 'manual' | 'import';
  kind: 'abstract' | 'session';
  initialStatus?: SubmissionStatus;                 // default 'pending'
  submitterContactId: ContactId | null;
  draftSubmissionId?: SubmissionId | null;          // M16 step 7 passes the client's draft id
  fields: { title: string; descriptionHtml?: string | null; trackId?: TrackId | null; formatId?: FormatId | null;
            level?: string | null; language?: string | null; capacity?: number | null;
            startsAt?: Date | null; endsAt?: Date | null; clientSessionId?: string | null };
  participants: Array<{ contactId: ContactId; role: ParticipantRole; isPrimary: boolean; sortOrder: number }>;
  answers: CleanAnswers;                            // empty branded array for manual/seed
  routing?: { setTrackId: TrackId | null; addTagIds: TagId[] } | null;   // computed by M16 via applyRouting
  tagIds?: TagId[];
  enforce?: { deadline?: boolean; limit?: boolean }; // default both true; manual/seed pass false
  sendConfirmation?: boolean;                        // default true for source='cfp'
};
```
  **`participants` carries `contactId`s only.** The caller resolves emails through `getOrCreateContact` **before** calling — [M16](./M16-submit-pipeline.md)'s submit route materializes co-speakers, `createSubmission` never does email→contact resolution itself.
- `speaker.ts`: `ContactDTO` (id, email, firstName, lastName, salutation, honorific, pronouns, gender, jobTitle, company, bioHtml, headshotFileId, 4 link urls, confirmationStatus, unsubscribedAt). The two **published** gallery DTOs live in `session.ts` below (one file, one import site for [M32](./M32-public-schedule-gallery.md)/[M33](./M33-embed-shells.md)/[M40](./M40-public-api.md)).
- `session.ts`: `ScheduledSessionDTO` `{id, title, slug, descriptionHtml, startsAt|null, endsAt|null, trackId|null, roomId|null, formatId|null, status, scheduleRevision, rowVersion, speakerIds}`. `ConflictDTO` `{kind:'room'|'speaker'|'track', severity:'error'|'warning', a:SessionId, b:SessionId, subjectId:string, overlapStartMs:number, overlapEndMs:number}` (S3 shape, verbatim). `MySessionDTO` `{sessionId, title, startsAt, endsAt, roomName, trackName}` (the My Sessions card in [M21](./M21-portal-shell.md), produced by [M28](./M28-sessions-crud.md)'s `getMySessions`).
  The four **published** DTOs, frozen here verbatim as [M32](./M32-public-schedule-gallery.md) derived them from `published_sessions_v`/`published_speakers_v` — M32 imports these and does not redeclare them:
```ts
type PublishedSessionDTO = {
  id: SessionId; slug: string; title: string; descriptionHtml: string | null;
  startsAt: string; endsAt: string;          // always non-null — the view excludes NULL-time rows
  dayKey: string;                            // eventDayKey, precomputed server-side
  track: { id: TrackId; name: string; color: string } | null;
  room: { id: RoomId; name: string } | null;
  format: { id: FormatId; name: string } | null;
  speakers: { contactId: ContactId; name: string; headshotUrl: string | null }[];
};
type PublishedScheduleDTO = {
  event: { name: string; timezone: string; startsAt: string; endsAt: string; accentColor: string | null };
  days: string[];                            // sorted eventDayKeys that have >= 1 session
  sessions: PublishedSessionDTO[];           // FLAT, sorted by startsAt — not nested day groups
};
type PublishedSpeakerDTO = {
  contactId: ContactId; name: string; jobTitle: string | null; company: string | null;
  bioHtml: string | null; headshotUrl: string | null;
  linkedinUrl: string | null; twitterUrl: string | null; websiteUrl: string | null;
  sessions: { id: SessionId; slug: string; title: string; startsAt: string; dayKey: string }[];
};
type PublishedSpeakersDTO = { event: { name: string; timezone: string; accentColor: string | null };
  speakers: PublishedSpeakerDTO[] };
```
- `task.ts`: `TaskDTO` `{id, name, descriptionHtml, targetType, completionMode, formId|null, fileRequestId|null, dueAt|null, isActive, createdAt}`. `TaskAssignmentDTO` `{taskId, contactId, submissionId|null, dueAt|null, completed, completedAt|null, completedVia|null, overdue}` — mirrors `task_assignments_v` 1:1. `OutstandingTasksRow` `{contactId, name, openCount, overdueCount, doneCount}`.
- `comms.ts`: **`CommLogRow`** `{id, contactId, recipientEmail, recipientName, templateKey, status, subjectRendered|null, providerMessageId|null, error|null, icsUid|null, submissionId|null, sessionId|null, taskId|null, createdAt, sentAt|null}` — field names are [M34](./M34-comms-outbox-dispatcher.md)'s (`recipientEmail`/`recipientName`, **not** `contactEmail`/`contactName`). **`bodyRenderedHtml` is deliberately NOT on the list row** — it is large and carries a live magic link. The detail sheet uses the sibling type:
  `CommLogDetail = CommLogRow & { bodyRenderedHtml: string | null; idempotencyKey: string; attempts: number }` — loaded by [M37](./M37-comms-admin-ui.md)'s detail fetch only, never returned by `listLog` and never exposed by [M40](./M40-public-api.md).
  [M27](./M27-speakers-admin.md) builds against `CommLogRow` from **Monday with fixture rows** (`src/shared/fixtures/comm-log.ts`, shipped in §10); [M37](./M37-comms-admin-ui.md) fills it Tuesday.
- **Done when:** each DTO has a fixture in `src/shared/fixtures/` that zod-parses in `fixtures.test.ts`.

### 5. `ui.ts` — `FormFieldRendererProps` (the WS-B ↔ WS-D boundary)
```ts
export type FormFieldRendererProps = {
  snapshot: FormSnapshot;
  answers: Record<FieldId, AnswerValue | undefined>;
  onChange: (fieldId: FieldId, value: AnswerValue | undefined) => void;
  mode: 'edit' | 'review' | 'readonly';       // THE union. There is no 'fill'.
  // Optional, frozen here at CP1 (not "via a later PR") because M15 Steps 1/6/7 already depend on all three:
  sectionKeys?: string[];                     // render a subset of sections
  participantId?: string | null;              // answer namespace for per-participant fields
  errors?: Record<string, string>;            // server field errors surfaced inline
};
```
Rules stated in the file: the implementation ([M15](./M15-public-cfp-wizard.md)) may import **nothing** from the CFP wizard's step/store code; [M25](./M25-task-runtime.md) consumes it as a black box against the golden fixture from Sunday and swaps the import at the **Mon-noon micro-checkpoint**. A miss fires cut-line #13 that day.
**`mode` is the single most-tested prop in the build** — the Mon-noon micro-checkpoint exists to validate exactly this swap. Task-form filling uses `mode="edit"` (it is the same interaction as CFP editing); `'fill'` exists in no contract and must appear in no call site. Any *new* prop must be **optional** and land via an architect-labeled PR, because a required addition breaks WS-D's already-written call sites.

### 6. `errors.ts` — the closed code enum
```ts
export const APP_ERROR_CODES = ['FORM_CLOSED','LIMIT_REACHED','FORM_LOCKED',
  'FORM_VERSION_STALE','STALE_WRITE','STALE_STATUS','NOT_FOUND','FORBIDDEN','UNAUTHORIZED',
  'VALIDATION','TEMPLATE_VAR_MISSING','RATE_LIMITED','CONFLICT','INTERNAL'] as const;
```
`FORM_VERSION_STALE`'s payload shape lives here too, in **one** frozen form: `{code:'FORM_VERSION_STALE', data: {snapshot: FormSnapshot, version: number}}` — [M16](./M16-submit-pipeline.md) throws it, `defineHandler` serializes it as `{error:{code, data}}` with **HTTP 409**, and [M15](./M15-public-cfp-wizard.md) re-renders from `data.snapshot` preserving matching answers. There is no `changed` field: M15's `remapAnswers` derives `dropped`/`newRequired` itself from the two snapshots, so a second source would only drift. [M04](./M04-shared-libs.md)'s `toHttp` maps `FORM_VERSION_STALE` into the **409** group alongside `STALE_WRITE`/`STALE_STATUS`, not the 400 group.
**Split of ownership:** M02 owns the *codes*; [M04](./M04-shared-libs.md) owns the `AppError` class, `isAppError`, and the HTTP mapping that imports them.

### 7. `limits.ts` — one char-count rule
```ts
export const LIMITS = { THEME: 1000, TITLE: 255, BIO: 5000, RICHTEXT: 5000,
  PAGE_HEADING: 15, SECTION_HEADING: 15 } as const;
export function plainTextLength(html: string): number; // [...stripTags(html)].length — code points
```
Used by client counters **and** server zod `.refine()`. DB `varchar(n)`/`CHECK` is a backstop only.

### 8. `idempotency.ts` — the seven recipes, frozen at CP1
```ts
export const idem = {
  received:     (e: EventId, s: SubmissionId) => `${e}:received:${s}`,
  decision:     (e: EventId, s: SubmissionId, notifyRevision: number) => `${e}:decision:${s}:${notifyRevision}`,
  taskAssigned: (e: EventId, t: TaskId, c: ContactId, sub: SubmissionId | null) => `${e}:task_assigned:${t}:${c}:${sub ?? '-'}`,
  taskReminder: (e: EventId, t: TaskId, c: ContactId, sub: SubmissionId | null, offsetDays: number) => `${e}:task_reminder:${t}:${c}:${sub ?? '-'}:${offsetDays}`,
  // A deliberate manual nudge must never be swallowed by the per-rung dedupe: the `:manual:` segment
  // is what separates it from a scanned rung, and the minute bucket makes double-clicks idempotent.
  taskReminderManual: (e: EventId, t: TaskId, c: ContactId, sub: SubmissionId | null, minuteBucket: number) =>
    `${e}:task_reminder:${t}:${c}:${sub ?? '-'}:manual:${minuteBucket}`,   // [M36](./M36-reminder-scan.md)'s sendReminderNow
  scheduled:    (e: EventId, s: SessionId, c: ContactId, scheduleRevision: number) => `${e}:sched:${s}:${c}:${scheduleRevision}`,
  // portal_login mail (M06b): the token id keeps re-issues distinct without leaking the raw token.
  portalLogin:  (e: EventId, c: ContactId, tokenId: TokenId) => `${e}:portal_login:${c}:${tokenId}`,
};
```
Doc comment, verbatim: *"Assignments are lazy view rows with no PK — keys are composed from the natural key, never from a nonexistent assignmentId. The decision recipient is the **submitter (primary) contact only**; co-speakers learn via the portal (pre-decided, PLAN Review decision #8)."*

### 9. `fanout.ts` — resolution #14 as a documented constant
```ts
export const TASK_FANOUT_RULE = {
  submissionTargeted: 'primary contact only, once per accepted submission (is_primary partial-unique makes this well-defined)',
  contactTargeted: 'members of accepted_speakers_v only',
} as const;
```
Same words appear in the `task_assignments_v` SQL comment ([M03](./M03-db-schema-migrations.md)). [M23](./M23-tasks-admin.md)/[M25](./M25-task-runtime.md)/[M36](./M36-reminder-scan.md)/[M38](./M38-dashboard.md) **consume the view; none re-derives the rule.**

### 9b. `deeplinks.ts` — the speakers-list query contract, so two lanes cannot re-invent it
[M27](./M27-speakers-admin.md) owns the filtered list; [M38](./M38-dashboard.md)'s alert bar and attention strip link into it. Freeze the param names here rather than in a channel message:
```ts
export const SPEAKERS_DEEPLINK_PARAMS = {
  missing:      ['bio', 'headshot', 'either'],   // ?missing=either is the combined bio-OR-headshot case
  accepted:     ['1'],                            // ?accepted=1
  confirmation: ['unconfirmed', 'confirmed', 'declined'],
  sort:         ['name', 'openTasks', 'confirmation'],
  dir:          ['asc', 'desc'],
} as const;
```
There is **no** `?filter=` param. The other two dashboard deep links are `/events/[id]/submissions?status=pending` and `/events/[id]/agenda?view=day`.

### 10. Fixtures, including the GOLDEN FormSnapshot (the single most-consumed Phase-0 artifact)
**`src/shared/fixtures/form-snapshot.ts`** — this exact path, quoted identically by [M13a](./M13a-condition-evaluator.md), [M15](./M15-public-cfp-wizard.md) and [M25](./M25-task-runtime.md); do not rename it. It exports **two** artifacts with **stable hard-coded uuids** (so tests can assert on ids):
- `GOLDEN_SNAPSHOT: FormSnapshot` — the compiled payload every renderer builds against.
- `GOLDEN_AUTHORING_ROWS: FormAuthoringRows` — the pre-compilation row set (form + sections + fields, in `sort_order`) that produces exactly `GOLDEN_SNAPSHOT`. [M04](./M04-shared-libs.md) §4's acceptance criterion is `compileFormSnapshot(GOLDEN_AUTHORING_ROWS)` deep-equalling `GOLDEN_SNAPSHOT`, so the two must be authored together, here.

Contents — **exactly one field of each of the 8 `COMMITTED_FIELD_TYPES`, asserted by a test in `fixtures.test.ts`** (M15 builds one input component per committed type against this fixture, so a missing type ships untested):
- section `abstract` ("Abstract Information", pageHeading "Submission"): **Title** (text, locked, required, maxChars 255, mapsTo `submission.title`) · **Description** (richtext, required, maxChars 5000, mapsTo `submission.description_html`) · **Notes for reviewers** (**textarea**, maxChars 1000) · **Track** (dropdown, required, 4 options each carrying `trackId`, mapsTo `submission.track_id`) · **Format** (dropdown, 5 options each carrying `formatId`, mapsTo `submission.format_id`) · **Workshop duration** (text, `visibility: {match:'all', conditions:[{sourceFieldId: FORMAT_ID, op:'eq', value: OPT_WORKSHOP}]}`) · **Topics** (multiselect, 5 options carrying `tagId`) · **Slides URL** (url) · **Supporting doc** (file).
- section `participant` ("Participant Information"): **First name** (text, locked, required, mapsTo `contact.first_name`) · **Last name** (locked, required) · **Email** (**email**, locked, required, mapsTo `contact.email`) · **Bio** (richtext, maxChars 5000, mapsTo `contact.bio_html`) · **Company** · **Job title**.

Also ship: `fixtures/contacts.ts`, `fixtures/submissions.ts` (incl. one all-nulls row and one `<img src=x onerror=alert(1)>` title), `fixtures/sessions.ts` (incl. one conflicting pair), `fixtures/tasks.ts`, `fixtures/comm-log.ts` (for [M27](./M27-speakers-admin.md) Monday), `fixtures/outstanding-tasks.ts` (for [M38](./M38-dashboard.md)).
- **Done when:** `pnpm vitest run src/shared/fixtures/fixtures.test.ts` parses every fixture through its schema, asserts `GOLDEN_SNAPSHOT` contains one field of each of the 8 committed types, and the golden snapshot round-trips `formSnapshotSchema.parse(JSON.parse(JSON.stringify(GOLDEN_SNAPSHOT)))`.

### 11. THE PHASE-0 STUB DROP — every cross-workstream signature, as throwing stubs
Create each barrel with `function notImplemented(name: string): never { throw new Error('STUB: ' + name); }` and export **exactly** these signatures. Copy the ones marked (res.) **verbatim** — they are binding resolutions, not suggestions. **A stub whose name or arity differs from the real export is worse than no stub** — the dependent compiles Saturday and breaks Sunday, which is exactly the failure this drop exists to prevent.

**`DbOrTx` — the one type that makes the `(tx, …)`-first helpers callable from non-transactional call sites.** Several resolution-#12/#13 helpers perform a single INSERT/UPDATE and are deliberately called on the `neon-http` handle so no fifth `withTx` path is opened (resolution #4). Export the union once, here (or from `src/db/client.ts` and re-export), and use it in every such signature:
```ts
export type DbOrTx = typeof db | TxDb;
```
Signatures restated with it — identical in [M34](./M34-comms-outbox-dispatcher.md), [M06b](./M06b-portal-auth.md), [M11](./M11-events-feature.md) and here:
`seedDefaultTemplates(dbOrTx: DbOrTx, eventId: EventId)` · `issuePortalToken(dbOrTx: DbOrTx, {contactId, eventId, purpose, ttl})`.

`src/features/submissions/index.ts` — (res. #8), the only owner of submission writes:
`createSubmission(eventId, input: CreateSubmissionInput)` · `updateSubmissionFromCfp(eventId, contactId, submissionId, answers: CleanAnswers)` · `upsertDraft(eventId, contactId, formId, formVersion)` · `nextSubmissionCode(tx, eventId)` · `transitionStatus(eventId, ids, to, expectedFrom)` · `notifyQueues(eventId)` · `withdraw(eventId, contactId, submissionId)` · `getAcceptedForScheduling(eventId): Promise<AcceptedForSchedulingRow[]>` · `listSubmissions(eventId, filters)` · **`getSubmissionDetail(eventId, submissionId)`** (M17's real name — not `getSubmission`) · `toPortalStatus(s: SubmissionStatus)` (pure; ship it real in the first slice — WS-D imports it Sunday) · `formatCode(code: number): string` · `<SubmissionAnswers>`.

`src/features/auth/index.ts` — `requireAdmin(eventId, role?)` · `requirePortal(eventSlug)` · `ensurePortalSession(contactId, eventId)` · **`issuePortalToken(dbOrTx: DbOrTx, {contactId, eventId, purpose, ttl, withOtp?})`** (res. #12; returns `{tokenId, raw, otp?, expiresAt}`, with `withOtp:true` only for portal-login issuance — rejected with `VALIDATION` for any purpose other than `magic_link` — and only hashes persisted) · **`verifyPortalToken(raw, {purpose})`** — the **non-consuming** verifier: hashes, checks `expires_at > now()` and `consumed_at IS NULL`, returns `{contactId, eventId} | null`, and **writes nothing** (this is what [M35](./M35-ics-calendar-invites.md)'s `/cal` routes call, so `ics_download` tokens keep `consumed_at` NULL forever). The **consuming** portal-login verifier is deliberately separate and feature-internal: `consumeToken(rawOrCode, {eventId, purpose})` ([M06b](./M06b-portal-auth.md) §2) compares the OTP hash, increments `attempts` atomically on mismatch (5 failures invalidate), returns explicit failure results, and sets `consumed_at` in the same guarded UPDATE only on success — it is **not** exported from the barrel, so no other feature can burn a login challenge. Also: `adminAuth`/`portalAuth`/`apiKeyAuth`/`cronAuth`/`publicAuth` guard **factories** for `defineHandler` (called as `adminAuth()`, never passed as a string). Ordinary email/calendar links are minted at dispatch; the `portal_login` exception carries its raw OTP/link only as an encrypted, clear-after-dispatch payload.

`src/features/portal/index.ts` — **`getOrCreateContact(tx, eventId, email)`** and **`updateContactFields(dbOrTx: DbOrTx, eventId, contactId, partial)`** (res. #13 — field-scoped, never whole-row; every writer goes through these two. `getOrCreateContact` is always called inside an audited transaction, so it stays `tx`-first; `updateContactFields` takes `DbOrTx` because M22's profile save and M27's email correction are single-statement guarded updates on the `neon-http` handle — same §11 pattern as `issuePortalToken`). **Their implementation file is `src/features/portal/server/contacts.ts` and it is owned by [M21](./M21-portal-shell.md), which ships it as its Step 0 in the first hour** — it gates M06b (Sat PM) and M18 (Sat PM), and [M01](./M01-scaffold-ci-deploy.md)'s grep #7 names it as the sole allowed writer of `contacts`. Also: `getSpeakerProfile` · `updateProfile` · `listMySubmissions(eventId, contactId)` · `listTasks(eventId)` · `saveTask` · `saveFileRequest` · `completeTaskViaResponse` · `completeTaskViaUpload` · `listContacts(eventId, filters)` · `getOutstandingTasksView(eventId): Promise<OutstandingTasksRow[]>` (implemented by [M27](./M27-speakers-admin.md), which already queries `speaker_outstanding_v`; [M40](./M40-public-api.md)'s `/speakers/outstanding-tasks` is its only consumer).

`src/features/comms/index.ts` — **`seedDefaultTemplates(dbOrTx: DbOrTx, eventId)`** (the single owner of default template rows; invoked by [M11](./M11-events-feature.md) event-create **and** [M09](./M09-seed-demo-script.md)) · **`listLog(eventId, filters): CommLogRow[]`** · `dispatchOutbox(budget): Promise<JobStats>` · `renderTemplate(key, vars)` · **`validateTemplateBody(key, subject, body)`** (3 args — subject tokens genuinely need validating; M34's own default subjects contain `{{submission.title}}`) · `scanReminders(): Promise<JobStats>` · `nudgeOutbox(waitUntil)` · `sendReminderNow(eventId, taskId, contactId, submissionId)` · `buildInvite(e: IcsEvent)` · **`buildFeed(calName: string, events: IcsEvent[])`**.

`src/features/embeds/index.ts` — **`getPublishedSchedule(eventSlug)`** · **`getPublishedSpeakers(eventSlug)`** (PROPOSED placement: both live in the `embeds` barrel; WS-E owns both folders and [M40](./M40-public-api.md) is a thin wrapper over them — zero drift, zero leak paths).

`src/features/agenda/index.ts` — `listSessions(eventId, view)` · `getSchedulableSessions(eventId, day?)` · `saveSession` · `deleteSession(eventId, id, expectedVersion)` · `bulkSetPublished(eventId, ids, published)` · `promoteSubmission(eventId, submissionId)` · `moveSession(eventId, {id, version, startsAt, endsAt, roomId})` · `detectConflicts(sessions)` · **`getMySessions(eventId, contactId): Promise<MySessionDTO[]>`** (the My Sessions card in [M21](./M21-portal-shell.md) — this is [M28](./M28-sessions-crud.md)'s real name; there is no `listMySessions`).

`src/features/forms/index.ts` — `listForms(eventId)` · `getFormForBuilder(eventId, formId)` · **`saveFormStep(eventId, formId, step, patch, expectedUpdatedAt)`** (5 args) · `getPublicForm(eventSlug, formId)` · **`formOpenState(form, nowIso): {open, reason}`** (the TS twin of the SQL fn — not `isFormOpen`) · `effectiveLimit(form, event): number` (`getPublicForm` needs it) · `getActiveRoutingRules(eventId, formId)` · `getPinnedSnapshot(eventId, formId, version)` · `getCurrentSnapshot(eventId, formId)` (all three consumed by [M16](./M16-submit-pipeline.md) Step 3 and [M17](./M17-abstracts-table.md) Step 11 **on Saturday**) · `compileAndPublish(eventId, formId)` · `<FormFieldRenderer>` · `runSubmitPipeline` / `deriveMappedFields` (the pure pipeline exports used by [M41](./M41-speaker-edit-until-close.md) and [M25](./M25-task-runtime.md)).

`src/features/events/index.ts` — `getEvent(eventId)` · `getEventBySlug(slug)` · `listTracks/listRooms/listFormats/listTags(eventId)` · `<EventSwitcher>` · `<TrackChip>`.

`src/features/dashboard/index.ts` — `getOverview(eventId)`.
`src/features/airtable/index.ts` — `runAirtableSync(budget)`.
- **Done when:** `pnpm typecheck` is green with all barrels present, and `grep -r "notImplemented(" src/features | wc -l` matches the count above.

### 12. Freeze
At CP1 the architect posts the freeze in `DECISIONS.md`. After that, **any PR touching `src/shared/contracts/**` carries the `contracts-change` label, is merged by the architect only, and every agent rebases immediately.**

## Acceptance criteria
Catalog AC, verbatim: *compiles standalone; every enum has exactly one const-array source; fixture data zod-parses; the golden FormSnapshot fixture parses.*

```bash
pnpm exec tsc --noEmit -p tsconfig.contracts.json     # contracts-only project, zero feature/db imports
pnpm vitest run src/shared/contracts                  # transitions matrix, limits, idempotency format
pnpm vitest run src/shared/fixtures                   # every fixture parses; golden snapshot round-trips
grep -rn "z.enum(\[" src/shared/contracts | wc -l     # 0 — enums come from const arrays only
```

## Guardrails
- **One const-array source per enum.** An inline `z.enum(['draft','pending'])` anywhere is a review-blocker: it is exactly how DB/API/UI drift.
- **Copy the resolutions verbatim.** `createSubmission`, `updateSubmissionFromCfp`, `upsertDraft`, `nextSubmissionCode` (res. #8); `issuePortalToken` (res. #12); `getOrCreateContact`/`updateContactFields` (res. #13); condition ops (res. #10); the fan-out rule (res. #14); the auto-confirm rule (res. #15). Inventing a variant here costs a full workstream a day.
- **No `contains` op** (res. #10). If you catch yourself adding one for multiselect, the answer is `in` over option ids.
- **Contracts import nothing.** No `@/db`, no `@/features/*`, no `@/shared/lib/*` beyond zod. The standalone tsc project is the enforcement.
- **Every DTO nullable is `| null`, not `?`** — `exactOptionalPropertyTypes` plus R10's `<Dash>` rule depend on the distinction, and draft submissions make nearly every field nullable.
- **Drafts never consume the submission limit** — write that sentence into `submission.ts` next to `CreateSubmissionInput` so [M16](./M16-submit-pipeline.md) and [M14](./M14-form-settings-notifications.md) cannot disagree.
- Time values cross the wire as ISO-8601 UTC strings (`z.iso.datetime()`), never `Date`. Zone math happens only in [M04](./M04-shared-libs.md)'s `time.ts`.
- Do **not** put the `AppError` class, the sanitizer, the evaluator, or `compileFormSnapshot` here — those are [M04](./M04-shared-libs.md) and [M13a](./M13a-condition-evaluator.md). Contracts hold *shapes and constants* only.

## If blocked
- **A zod v4-specific helper is blocked:** still write the const arrays, transition map, idempotency builders, `limits.ts`, `fanout.ts` and `FormFieldRendererProps`; keep the temporary workaround inside the one affected schema and do not downgrade or dual-version zod.
- **Uncertain about a DTO's exact columns:** ship the fields the analysis docs name and mark unknowns `// TODO-CP1` — a present-but-incomplete DTO unblocks a whole workstream; an absent one blocks it.
- **Stub drop done early:** start [M03](./M03-db-schema-migrations.md)'s `src/db/schema/*.ts` files, since they import these enums directly and are the next fan-out gate.
