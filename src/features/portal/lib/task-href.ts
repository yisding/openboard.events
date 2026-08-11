import type { MyTaskDTO } from "@/features/portal";

/**
 * The URL that completes exactly this assignment, submission and all.
 *
 * It lives here, in a plain module, rather than beside the component that first
 * needed it. `task-list.tsx` carries `"use client"`, and a `"use client"` file's
 * exports are *references* to client code, not values a server component may
 * call: `SpeakerHomeHero` (a server component, M59) importing this from there
 * rendered the portal home as
 *
 *   Attempted to call taskHref() from the server but taskHref is on the client.
 *
 * — a 500 on `/portal/<slug>` for every speaker whose hero was a task, which is
 * every speaker with something due. Nothing about the function is client-only:
 * it is string arithmetic over a DTO, so both sides import it from here and the
 * boundary never enters into it.
 */
export function taskHref(eventSlug: string, task: MyTaskDTO): string {
  const query = task.submissionId ? `?submissionId=${task.submissionId}` : "";
  return `/portal/${encodeURIComponent(eventSlug)}/tasks/${task.taskId}${query}`;
}
