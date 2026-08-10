import { and, asc, eq, isNull, ne } from "drizzle-orm";
import {
  contacts,
  events,
  fileRequests,
  formFields,
  forms,
  formSections,
  formVersions,
  portalTasks,
  resourcePages,
  taskCompletions,
} from "@/db/schema";
import type { FormAuthoringRows } from "@/shared/contracts";
import { compileFormSnapshot } from "@/shared/lib/form-snapshot";
import { eventLocal, type SeedCtx } from "./lib/helpers";

type PortalFormSeed = {
  key: "profile-update" | "session-info";
  internalName: string;
  externalTitle: string;
  targetType: "contact" | "submission";
  rows: FormAuthoringRows;
};

function portalFormSeeds(ctx: SeedCtx): PortalFormSeed[] {
  const makeIds = (formKey: PortalFormSeed["key"]) => ({
    formId: ctx.id("form", formKey) as FormAuthoringRows["form"]["id"],
    sectionId: ctx.id("section", `${formKey}-details`) as FormAuthoringRows["sections"][number]["id"],
    fieldId: (key: string) => ctx.id("field", `${formKey}-${key}`) as FormAuthoringRows["fields"][number]["id"],
  });
  const fieldBase: Pick<
    FormAuthoringRows["fields"][number],
    "required" | "locked" | "maxChars" | "helpText" | "options" | "visibility" | "deletedAt"
  > = {
    required: false,
    locked: false,
    maxChars: null,
    helpText: "",
    options: [],
    visibility: null,
    deletedAt: null,
  };

  const profile = makeIds("profile-update");
  const session = makeIds("session-info");

  return [
    {
      key: "profile-update",
      internalName: "Profile update",
      externalTitle: "Update your information",
      targetType: "contact",
      rows: {
        form: { id: profile.formId, context: "portal", version: 1 },
        sections: [{
          id: profile.sectionId,
          key: "profile",
          title: "Your profile",
          pageHeading: "Profile",
          descriptionHtml: "<p>Keep the information shown to attendees up to date.</p>",
          sortOrder: 0,
        }],
        fields: [
          { ...fieldBase, id: profile.fieldId("bio"), sectionId: profile.sectionId, key: "bio", label: "Bio", fieldType: "richtext", maxChars: 5000, mapsTo: "contact.bio_html", sortOrder: 0 },
          { ...fieldBase, id: profile.fieldId("headshot"), sectionId: profile.sectionId, key: "headshot", label: "Headshot", fieldType: "file", mapsTo: "contact.headshot_file_id", sortOrder: 1 },
          { ...fieldBase, id: profile.fieldId("pronouns"), sectionId: profile.sectionId, key: "pronouns", label: "Pronouns", fieldType: "text", mapsTo: "contact.pronouns", sortOrder: 2 },
          { ...fieldBase, id: profile.fieldId("company"), sectionId: profile.sectionId, key: "company", label: "Company", fieldType: "text", mapsTo: "contact.company", sortOrder: 3 },
          { ...fieldBase, id: profile.fieldId("job-title"), sectionId: profile.sectionId, key: "job_title", label: "Job Title", fieldType: "text", mapsTo: "contact.job_title", sortOrder: 4 },
        ],
      },
    },
    {
      key: "session-info",
      internalName: "Session information",
      externalTitle: "Update your session",
      targetType: "submission",
      rows: {
        form: { id: session.formId, context: "portal", version: 1 },
        sections: [{
          id: session.sectionId,
          key: "session",
          title: "Session information",
          pageHeading: "Session",
          descriptionHtml: "<p>Review the information attendees will see for this session.</p>",
          sortOrder: 0,
        }],
        fields: [
          { ...fieldBase, id: session.fieldId("title"), sectionId: session.sectionId, key: "title", label: "Session Title", fieldType: "text", required: true, maxChars: 255, mapsTo: "submission.title", sortOrder: 0 },
          { ...fieldBase, id: session.fieldId("description"), sectionId: session.sectionId, key: "description", label: "Session Description", fieldType: "richtext", maxChars: 5000, mapsTo: "submission.description_html", sortOrder: 1 },
          {
            ...fieldBase,
            id: session.fieldId("level"),
            sectionId: session.sectionId,
            key: "level",
            label: "Session Level",
            fieldType: "dropdown",
            mapsTo: "submission.level",
            options: [
              { id: "beginner", label: "Beginner" },
              { id: "intermediate", label: "Intermediate" },
              { id: "advanced", label: "Advanced" },
            ],
            sortOrder: 2,
          },
        ],
      },
    },
  ];
}

async function seedPortalForms(ctx: SeedCtx): Promise<PortalFormSeed[]> {
  const { tx, eventId } = ctx;
  const seeds = portalFormSeeds(ctx);

  for (const seed of seeds) {
    const { rows } = seed;
    await tx.insert(forms).values({
      id: rows.form.id,
      eventId,
      context: "portal",
      internalName: seed.internalName,
      externalTitle: seed.externalTitle,
      status: "open",
      collectParticipants: false,
      showWelcome: false,
      sendConfirmation: false,
      autoRedirectToPortal: false,
      targetType: seed.targetType,
      currentVersion: 1,
    }).onConflictDoUpdate({
      target: forms.id,
      set: {
        context: "portal",
        internalName: seed.internalName,
        externalTitle: seed.externalTitle,
        status: "open",
        collectParticipants: false,
        showWelcome: false,
        sendConfirmation: false,
        autoRedirectToPortal: false,
        targetType: seed.targetType,
        currentVersion: 1,
        updatedAt: new Date(),
      },
    });

    for (const section of rows.sections) {
      await tx.insert(formSections).values({
        id: section.id,
        eventId,
        formId: rows.form.id,
        key: section.key,
        title: section.title,
        pageHeading: section.pageHeading,
        descriptionHtml: section.descriptionHtml,
        sortOrder: section.sortOrder,
      }).onConflictDoUpdate({
        target: formSections.id,
        set: {
          key: section.key,
          title: section.title,
          pageHeading: section.pageHeading,
          descriptionHtml: section.descriptionHtml,
          sortOrder: section.sortOrder,
          updatedAt: new Date(),
        },
      });
    }

    for (const field of rows.fields) {
      const reconciledAt = new Date();
      await tx.update(formFields)
        .set({ deletedAt: reconciledAt, updatedAt: reconciledAt })
        .where(and(
          eq(formFields.formId, rows.form.id),
          eq(formFields.key, field.key),
          isNull(formFields.deletedAt),
          ne(formFields.id, field.id),
        ));
      await tx.insert(formFields).values({
        id: field.id,
        eventId,
        formId: rows.form.id,
        sectionId: field.sectionId,
        key: field.key,
        label: field.label,
        fieldType: field.fieldType,
        required: field.required,
        locked: field.locked,
        maxChars: field.maxChars,
        helpText: field.helpText,
        options: field.options,
        visibility: field.visibility,
        mapsTo: field.mapsTo,
        sortOrder: field.sortOrder,
        deletedAt: null,
      }).onConflictDoUpdate({
        target: formFields.id,
        set: {
          sectionId: field.sectionId,
          key: field.key,
          label: field.label,
          fieldType: field.fieldType,
          required: field.required,
          locked: field.locked,
          maxChars: field.maxChars,
          helpText: field.helpText,
          options: field.options,
          visibility: field.visibility,
          mapsTo: field.mapsTo,
          sortOrder: field.sortOrder,
          deletedAt: null,
          updatedAt: new Date(),
        },
      });
    }

    const snapshot = compileFormSnapshot(rows);
    await tx.insert(formVersions).values({
      id: ctx.id("form_version", `${seed.key}-1`),
      eventId,
      formId: rows.form.id,
      version: 1,
      snapshot,
    }).onConflictDoUpdate({
      target: formVersions.id,
      set: { snapshot },
    });
  }

  return seeds;
}

/**
 * Owned by M21 (WS-D).
 *
 * The speaker portal's furniture: two renderable portal forms; three tasks, one
 * per completion mode, with one
 * already overdue so the overdue list is never empty and the reminder scan has a
 * due row on its very first tick; the file request one of them completes
 * against; and two resource pages that are also the sanitizer's standing probes.
 *
 * It never invents an id it does not own: the event and contacts belong to other
 * modules, so each absence degrades to something still useful rather than to a
 * crash. The forms live here because they are the task runtime's fallback fixture.
 */
export async function seedPortal(ctx: SeedCtx): Promise<void> {
  const { tx, eventId } = ctx;

  // events.ts owns the event row. Without it every insert here fails its foreign
  // key, which would take the whole run down for a module that has not run yet.
  const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) {
    ctx.log("skipped — the event does not exist yet (events.ts)");
    return;
  }

  const portalFormSeeds = await seedPortalForms(ctx);
  const profileForm = portalFormSeeds.find((seed) => seed.key === "profile-update");
  if (!profileForm) throw new Error("profile-update portal form seed is missing");

  const slidesRequestId = ctx.id("file_request", "slides");
  await tx.insert(fileRequests).values({
    id: slidesRequestId,
    eventId,
    title: "Final slide deck",
    instructionsHtml: "<p>PDF or Keynote, 16:9. Upload a backup PDF even if you present from your own laptop.</p>",
    acceptedExtensions: ["pdf", "key", "pptx"],
    maxSizeMb: 100,
  }).onConflictDoUpdate({
    target: fileRequests.id,
    set: { title: "Final slide deck", maxSizeMb: 100, updatedAt: new Date() },
  });

  const tasks = [
    {
      key: "confirm-details",
      name: "Confirm your session details",
      descriptionHtml: "<p>Check the title, abstract and duration we have on file for your session.</p>",
      completionMode: "manual" as const,
      // Two days past due: the overdue list must never be empty for a demo, and
      // the reminder scan needs something to find on its first run.
      dueAt: eventLocal(ctx.now, -2, "17:00"),
      sortOrder: 0,
      fileRequestId: null,
      formId: null,
    },
    {
      key: "upload-slides",
      name: "Upload your slides",
      descriptionHtml: "<p>We collect decks a week ahead so the AV team can test every laptop.</p>",
      completionMode: "file_request" as const,
      dueAt: eventLocal(ctx.now, 30, "17:00"),
      sortOrder: 1,
      fileRequestId: slidesRequestId,
      formId: null,
    },
    {
      // Keep the original deterministic key so re-seeding upgrades existing
      // demo databases instead of leaving the old travel task behind.
      key: "travel-form",
      name: "Update your profile",
      descriptionHtml: "<p>Review your bio, headshot, pronouns, company, and job title.</p>",
      completionMode: "form" as const,
      dueAt: eventLocal(ctx.now, 45, "17:00"),
      sortOrder: 2,
      fileRequestId: null,
      formId: profileForm.rows.form.id,
    },
  ];

  for (const task of tasks) {
    await tx.insert(portalTasks).values({
      id: ctx.id("task", task.key),
      eventId,
      name: task.name,
      descriptionHtml: task.descriptionHtml,
      targetType: "contact",
      completionMode: task.completionMode,
      dueAt: task.dueAt,
      sortOrder: task.sortOrder,
      ...(task.fileRequestId ? { fileRequestId: task.fileRequestId } : {}),
      ...(task.formId ? { formId: task.formId } : {}),
    }).onConflictDoUpdate({
      target: portalTasks.id,
      set: {
        name: task.name,
        descriptionHtml: task.descriptionHtml,
        dueAt: task.dueAt,
        completionMode: task.completionMode,
        formId: task.formId,
        fileRequestId: task.fileRequestId,
        updatedAt: new Date(),
      },
    });
  }

  // Both pages are sanitizer probes as much as content: the first carries an
  // allowlisted YouTube iframe that the `wide` profile must keep, the second a
  // <script> that every profile must strip. If either ever renders wrongly, it
  // is visible on a page a judge actually opens.
  const pages = [
    {
      key: "speaker-handbook",
      title: "Speaker handbook",
      slug: "speaker-handbook",
      summary: "Arrival, check-in, stage logistics and what to expect from the production team.",
      bodyHtml: "<h2>Welcome</h2><p>Check in at the Speaker Lounge at least 45 minutes before your session.</p>"
        + '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Stage walkthrough" width="560" height="315" allowfullscreen></iframe>',
      sortOrder: 0,
    },
    {
      key: "presentation-guidelines",
      title: "Presentation guidelines",
      slug: "presentation-guidelines",
      summary: "Slides, aspect ratio, demos and accessibility guidance.",
      bodyHtml: "<h2>Guidelines</h2><p>Design for 16:9, use at least 28pt type, and keep live demos focused.</p>"
        + "<script>alert('this must never run')</script><p>Upload a PDF backup with your final deck.</p>",
      sortOrder: 1,
    },
  ];

  for (const page of pages) {
    await tx.insert(resourcePages).values({
      id: ctx.id("resource", page.key),
      eventId,
      title: page.title,
      slug: page.slug,
      summary: page.summary,
      bodyHtml: page.bodyHtml,
      sortOrder: page.sortOrder,
      published: true,
    }).onConflictDoUpdate({
      target: resourcePages.id,
      set: { title: page.title, summary: page.summary, bodyHtml: page.bodyHtml, updatedAt: new Date() },
    });
  }

  // Mixed completions need contacts, which contacts.ts owns. Once they exist the
  // demo needs one task visibly done — an all-outstanding list reads as a portal
  // nobody has ever used.
  const speakers = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.eventId, eventId))
    .orderBy(asc(contacts.createdAt))
    .limit(1);
  const firstSpeaker = speakers[0];
  if (firstSpeaker) {
    await tx.insert(taskCompletions).values({
      id: ctx.id("completion", "confirm-details"),
      eventId,
      taskId: ctx.id("task", "confirm-details"),
      contactId: firstSpeaker.id,
      completedVia: "manual",
    }).onConflictDoNothing({ target: taskCompletions.id });
  }

  ctx.log(`seeded ${portalFormSeeds.length} portal forms, ${tasks.length} tasks, 1 file request, ${pages.length} resource pages`
    + `${firstSpeaker ? ", 1 completion" : " (no completions — contacts.ts has not run)"}`);
}
