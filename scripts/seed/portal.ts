import { fileRequests, portalTasks, resourcePages } from "@/db/schema";
import { eventLocal, type SeedCtx } from "./lib/helpers";

/**
 * Owned by M21 (WS-D).
 *
 * The speaker portal's furniture: three tasks, one per completion mode, with one
 * already overdue so the overdue list is never empty and the reminder scan has a
 * due row on its very first tick; the file request one of them completes
 * against; and two resource pages that are also the sanitizer's standing probes.
 *
 * Everything here is event-scoped. Completions and uploads need contacts, which
 * `contacts.ts` owns — this module deliberately seeds nothing that would have to
 * guess at a contact id.
 */
export async function seedPortal(ctx: SeedCtx): Promise<void> {
  const { tx, eventId } = ctx;

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
    },
    {
      key: "upload-slides",
      name: "Upload your slides",
      descriptionHtml: "<p>We collect decks a week ahead so the AV team can test every laptop.</p>",
      completionMode: "file_request" as const,
      dueAt: eventLocal(ctx.now, 30, "17:00"),
      sortOrder: 1,
      fileRequestId: slidesRequestId,
    },
    {
      key: "travel-form",
      name: "Tell us about your travel",
      descriptionHtml: "<p>Arrival day, dietary needs, and whether you want a hotel room held.</p>",
      // The form itself belongs to forms.ts; the task points at it once that
      // module fills in, and stays a plain assignment until then.
      completionMode: "manual" as const,
      dueAt: eventLocal(ctx.now, 45, "17:00"),
      sortOrder: 2,
      fileRequestId: null,
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
    }).onConflictDoUpdate({
      target: portalTasks.id,
      set: { name: task.name, descriptionHtml: task.descriptionHtml, dueAt: task.dueAt, updatedAt: new Date() },
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

  ctx.log(`seeded ${tasks.length} tasks, 1 file request, ${pages.length} resource pages`);
}
