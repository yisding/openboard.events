import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getMyTask, getTaskForm, requirePortalContext } from "@/features/portal";
import { TaskDetailView } from "@/features/portal/task-runtime/components/task-detail";

export const metadata: Metadata = { title: "Task" };
export const dynamic = "force-dynamic";

/**
 * One assignment. The same task id can be assigned several times — once per
 * accepted submission — so `?submissionId=` is part of the address, not a hint.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ eventSlug: string; taskId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { eventSlug, taskId } = await params;
  const query = await searchParams;
  // Both ids reach SQL as uuids, so a typed-in path is a 404 rather than a
  // 22P02 crash page.
  const parsedTaskId = z.uuid().safeParse(taskId);
  const parsedSubmissionId = z.uuid().nullable().safeParse(typeof query.submissionId === "string" ? query.submissionId : null);
  if (!parsedTaskId.success || !parsedSubmissionId.success) notFound();
  const submissionId = parsedSubmissionId.data;

  const { event, contact } = await requirePortalContext(eventSlug);
  const task = await getMyTask(event.id, contact.id, parsedTaskId.data, submissionId);
  // A task routed to somebody else has to look exactly like one that is not there.
  if (!task) notFound();

  const form = task.completionMode === "form" && task.formId
    ? await getTaskForm(event.id, contact.id, task.formId, submissionId)
    : null;

  return (
    <TaskDetailView
      eventId={event.id}
      eventSlug={event.slug}
      timezone={event.timezone}
      task={task}
      form={form}
    />
  );
}
