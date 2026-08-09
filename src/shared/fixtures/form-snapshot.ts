import {
  fieldIdSchema,
  formIdSchema,
  formSnapshotSchema,
  formatIdSchema,
  sectionIdSchema,
  tagIdSchema,
  trackIdSchema,
  type FormAuthoringRows,
} from "@/shared/contracts";

const FORM = formIdSchema.parse("00000000-0000-4000-8000-000000000001");
const ABSTRACT = sectionIdSchema.parse("00000000-0000-4000-8000-000000000010");
const PARTICIPANT = sectionIdSchema.parse("00000000-0000-4000-8000-000000000011");
const TITLE = fieldIdSchema.parse("00000000-0000-4000-8000-000000000100");
const DESCRIPTION = fieldIdSchema.parse("00000000-0000-4000-8000-000000000101");
const NOTES = fieldIdSchema.parse("00000000-0000-4000-8000-000000000102");
const TRACK = fieldIdSchema.parse("00000000-0000-4000-8000-000000000103");
const TOPICS = fieldIdSchema.parse("00000000-0000-4000-8000-000000000104");
const SLIDES = fieldIdSchema.parse("00000000-0000-4000-8000-000000000105");
const SUPPORTING = fieldIdSchema.parse("00000000-0000-4000-8000-000000000106");
const FIRST = fieldIdSchema.parse("00000000-0000-4000-8000-000000000107");
const LAST = fieldIdSchema.parse("00000000-0000-4000-8000-000000000108");
const EMAIL = fieldIdSchema.parse("00000000-0000-4000-8000-000000000109");
const FORMAT = fieldIdSchema.parse("00000000-0000-4000-8000-000000000110");
const WORKSHOP_DURATION = fieldIdSchema.parse("00000000-0000-4000-8000-000000000111");
const BIO = fieldIdSchema.parse("00000000-0000-4000-8000-000000000112");
const COMPANY = fieldIdSchema.parse("00000000-0000-4000-8000-000000000113");
const JOB_TITLE = fieldIdSchema.parse("00000000-0000-4000-8000-000000000114");
const TRACK_ID = trackIdSchema.parse("00000000-0000-4000-8000-000000000200");
const TRACK_PLATFORM_ID = trackIdSchema.parse("00000000-0000-4000-8000-000000000203");
const TRACK_SECURITY_ID = trackIdSchema.parse("00000000-0000-4000-8000-000000000204");
const TRACK_COMMUNITY_ID = trackIdSchema.parse("00000000-0000-4000-8000-000000000205");
const FORMAT_TALK_ID = formatIdSchema.parse("00000000-0000-4000-8000-000000000210");
const FORMAT_WORKSHOP_ID = formatIdSchema.parse("00000000-0000-4000-8000-000000000211");
const FORMAT_PANEL_ID = formatIdSchema.parse("00000000-0000-4000-8000-000000000212");
const FORMAT_LIGHTNING_ID = formatIdSchema.parse("00000000-0000-4000-8000-000000000213");
const FORMAT_KEYNOTE_ID = formatIdSchema.parse("00000000-0000-4000-8000-000000000214");
const TAG_ID = tagIdSchema.parse("00000000-0000-4000-8000-000000000202");
const TAG_SAFETY_ID = tagIdSchema.parse("00000000-0000-4000-8000-000000000220");
const TAG_PLATFORM_ID = tagIdSchema.parse("00000000-0000-4000-8000-000000000221");
const TAG_OPEN_SOURCE_ID = tagIdSchema.parse("00000000-0000-4000-8000-000000000222");
const TAG_COMMUNITY_ID = tagIdSchema.parse("00000000-0000-4000-8000-000000000223");

const baseField = {
  required: false,
  locked: false,
  maxChars: null,
  helpText: "",
  options: [],
  visibility: null,
  mapsTo: null,
  deletedAt: null,
};

export const GOLDEN_AUTHORING_ROWS: FormAuthoringRows = {
  form: { id: FORM, context: "cfp", version: 1 },
  sections: [
    { id: ABSTRACT, key: "abstract", title: "Abstract Information", pageHeading: "Submission", descriptionHtml: "<p>Tell us what you want to share.</p>", sortOrder: 0 },
    { id: PARTICIPANT, key: "participant", title: "Participant Information", pageHeading: "Speaker", descriptionHtml: "<p>Tell us about yourself.</p>", sortOrder: 1 },
  ],
  fields: [
    { ...baseField, id: TITLE, sectionId: ABSTRACT, key: "title", label: "Title", fieldType: "text", required: true, locked: true, maxChars: 255, mapsTo: "submission.title", sortOrder: 0 },
    { ...baseField, id: DESCRIPTION, sectionId: ABSTRACT, key: "description", label: "Description", fieldType: "richtext", required: true, maxChars: 5000, mapsTo: "submission.description_html", sortOrder: 1 },
    { ...baseField, id: NOTES, sectionId: ABSTRACT, key: "notes", label: "Notes for reviewers", fieldType: "textarea", maxChars: 1000, sortOrder: 2 },
    { ...baseField, id: TRACK, sectionId: ABSTRACT, key: "track", label: "Track", fieldType: "dropdown", required: true, options: [
      { id: "agents", label: "AI Agents", trackId: TRACK_ID },
      { id: "platforms", label: "Platforms", trackId: TRACK_PLATFORM_ID },
      { id: "security", label: "Security", trackId: TRACK_SECURITY_ID },
      { id: "community", label: "Community", trackId: TRACK_COMMUNITY_ID },
    ], mapsTo: "submission.track_id", sortOrder: 3 },
    { ...baseField, id: FORMAT, sectionId: ABSTRACT, key: "format", label: "Format", fieldType: "dropdown", required: true, options: [
      { id: "talk", label: "Talk", formatId: FORMAT_TALK_ID },
      { id: "workshop", label: "Workshop", formatId: FORMAT_WORKSHOP_ID },
      { id: "panel", label: "Panel", formatId: FORMAT_PANEL_ID },
      { id: "lightning", label: "Lightning talk", formatId: FORMAT_LIGHTNING_ID },
      { id: "keynote", label: "Keynote", formatId: FORMAT_KEYNOTE_ID },
    ], mapsTo: "submission.format_id", sortOrder: 4 },
    { ...baseField, id: WORKSHOP_DURATION, sectionId: ABSTRACT, key: "workshop_duration", label: "Workshop duration", fieldType: "text", visibility: { match: "all", conditions: [{ sourceFieldId: FORMAT, op: "eq", value: "workshop" }] }, sortOrder: 5 },
    { ...baseField, id: TOPICS, sectionId: ABSTRACT, key: "topics", label: "Topics", fieldType: "multiselect", options: [
      { id: "evals", label: "Evals", tagId: TAG_ID },
      { id: "safety", label: "Safety", tagId: TAG_SAFETY_ID },
      { id: "platforms", label: "Platforms", tagId: TAG_PLATFORM_ID },
      { id: "open-source", label: "Open source", tagId: TAG_OPEN_SOURCE_ID },
      { id: "community", label: "Community", tagId: TAG_COMMUNITY_ID },
    ], sortOrder: 6 },
    { ...baseField, id: SLIDES, sectionId: ABSTRACT, key: "slides", label: "Slides URL", fieldType: "url", sortOrder: 7 },
    { ...baseField, id: SUPPORTING, sectionId: ABSTRACT, key: "supporting", label: "Supporting doc", fieldType: "file", sortOrder: 8 },
    { ...baseField, id: FIRST, sectionId: PARTICIPANT, key: "first_name", label: "First name", fieldType: "text", required: true, locked: true, mapsTo: "contact.first_name", sortOrder: 0 },
    { ...baseField, id: LAST, sectionId: PARTICIPANT, key: "last_name", label: "Last name", fieldType: "text", required: true, locked: true, mapsTo: "contact.last_name", sortOrder: 1 },
    { ...baseField, id: EMAIL, sectionId: PARTICIPANT, key: "email", label: "Email", fieldType: "email", required: true, locked: true, mapsTo: "contact.email", sortOrder: 2 },
    { ...baseField, id: BIO, sectionId: PARTICIPANT, key: "bio", label: "Bio", fieldType: "richtext", maxChars: 5000, mapsTo: "contact.bio_html", sortOrder: 3 },
    { ...baseField, id: COMPANY, sectionId: PARTICIPANT, key: "company", label: "Company", fieldType: "text", mapsTo: "contact.company", sortOrder: 4 },
    { ...baseField, id: JOB_TITLE, sectionId: PARTICIPANT, key: "job_title", label: "Job title", fieldType: "text", mapsTo: "contact.job_title", sortOrder: 5 },
  ],
};

export const GOLDEN_SNAPSHOT = formSnapshotSchema.parse({
  formId: FORM,
  version: 1,
  context: "cfp",
  sections: GOLDEN_AUTHORING_ROWS.sections.map((section) => ({
    id: section.id,
    key: section.key,
    title: section.title,
    pageHeading: section.pageHeading,
    descriptionHtml: section.descriptionHtml,
    fields: GOLDEN_AUTHORING_ROWS.fields
      .filter((field) => field.sectionId === section.id && field.deletedAt === null)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((field) => ({
        id: field.id,
        key: field.key,
        label: field.label,
        type: field.fieldType,
        required: field.required,
        locked: field.locked,
        maxChars: field.maxChars,
        helpText: field.helpText,
        options: field.options,
        visibility: field.visibility,
        mapsTo: field.mapsTo,
      })),
  })),
});
