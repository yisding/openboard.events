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
const TRACK_ID = trackIdSchema.parse("00000000-0000-4000-8000-000000000200");
const FORMAT_ID = formatIdSchema.parse("00000000-0000-4000-8000-000000000201");
const TAG_ID = tagIdSchema.parse("00000000-0000-4000-8000-000000000202");

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
    { ...baseField, id: TRACK, sectionId: ABSTRACT, key: "track", label: "Track", fieldType: "dropdown", required: true, options: [{ id: "agents", label: "AI Agents", trackId: TRACK_ID }], mapsTo: "submission.track_id", sortOrder: 3 },
    { ...baseField, id: FORMAT, sectionId: ABSTRACT, key: "format", label: "Format", fieldType: "dropdown", required: true, options: [{ id: "talk", label: "Talk", formatId: FORMAT_ID }], mapsTo: "submission.format_id", sortOrder: 4 },
    { ...baseField, id: TOPICS, sectionId: ABSTRACT, key: "topics", label: "Topics", fieldType: "multiselect", options: [{ id: "evals", label: "Evals", tagId: TAG_ID }], visibility: { match: "all", conditions: [{ sourceFieldId: TRACK, op: "answered" }] }, sortOrder: 5 },
    { ...baseField, id: SLIDES, sectionId: ABSTRACT, key: "slides", label: "Slides URL", fieldType: "url", sortOrder: 6 },
    { ...baseField, id: SUPPORTING, sectionId: ABSTRACT, key: "supporting", label: "Supporting document", fieldType: "file", sortOrder: 7 },
    { ...baseField, id: FIRST, sectionId: PARTICIPANT, key: "first_name", label: "First name", fieldType: "text", required: true, locked: true, mapsTo: "contact.first_name", sortOrder: 0 },
    { ...baseField, id: LAST, sectionId: PARTICIPANT, key: "last_name", label: "Last name", fieldType: "text", required: true, locked: true, mapsTo: "contact.last_name", sortOrder: 1 },
    { ...baseField, id: EMAIL, sectionId: PARTICIPANT, key: "email", label: "Email", fieldType: "email", required: true, locked: true, mapsTo: "contact.email", sortOrder: 2 },
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
