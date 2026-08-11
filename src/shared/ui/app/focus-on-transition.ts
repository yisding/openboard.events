export type FocusTarget = { readonly current: { focus: () => void } | null };
export type AnimationFrameScheduler = Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame">;

/** Schedule focus after React has committed the replacement step. */
export function focusOnNextFrame(target: FocusTarget, scheduler: AnimationFrameScheduler = window): () => void {
  const frame = scheduler.requestAnimationFrame(() => target.current?.focus());
  return () => scheduler.cancelAnimationFrame(frame);
}
