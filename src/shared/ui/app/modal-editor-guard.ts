export function editorDraftChanged<T>(draft: T, baseline: T): boolean {
  return JSON.stringify(draft) !== JSON.stringify(baseline);
}

export function requestGuardedEditorClose({
  busy,
  dirty,
  runGuarded,
  close,
}: {
  busy: boolean;
  dirty: boolean;
  runGuarded: (action: () => void) => void;
  close: () => void;
}): boolean {
  if (busy) return false;
  if (dirty) runGuarded(close);
  else close();
  return true;
}
