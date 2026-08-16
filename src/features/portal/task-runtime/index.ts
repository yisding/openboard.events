/**
 * The speaker task runtime — what a speaker still owes, and the three ways they
 * discharge it. Re-exported through `@/features/portal`.
 */
export type { MyTaskDTO, MyTaskDetail, TaskCompletionRow } from "./server/queries";
export {
  getMyTask,
  getMyTaskIn,
  getTaskForm,
  getTaskFormIn,
  listMyTasks,
  listMyTasksIn,
  listTaskCompletions,
  listTaskCompletionsIn,
} from "./server/queries";
export {
  addTaskComment,
  addTaskCommentIn,
  completeTaskManual,
  completeTaskManualIn,
  completeTaskViaResponse,
  completeTaskViaResponseIn,
  completeTaskViaUpload,
  completeTaskViaUploadIn,
  finalizeAndCompleteTaskUpload,
} from "./server/mutations";
