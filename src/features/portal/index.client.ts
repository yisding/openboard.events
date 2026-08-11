/**
 * What a client component may import from the portal feature. The server barrel
 * reaches the database and the session, so importing a component from it drags
 * `next/headers` into the browser bundle and the build fails — which is how this
 * file came to exist.
 */
export type { TaskCompletionRow } from "./task-runtime/server/queries";
export { TaskResponseViewer, TaskUploadViewer } from "./task-runtime/components/task-viewers";
export { TaskList } from "./task-runtime/components/task-list";
// Not from `task-list` any more: a `"use client"` module's exports cannot be
// called by a server component, and `SpeakerHomeHero` has to call this one.
export { taskHref } from "./lib/task-href";
export { TaskDetailView } from "./task-runtime/components/task-detail";
