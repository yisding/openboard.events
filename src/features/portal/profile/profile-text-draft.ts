export function textDraftChanged<T extends object>(draft: T, baseline: T): boolean {
  const keys = new Set<keyof T>([
    ...Object.keys(draft) as Array<keyof T>,
    ...Object.keys(baseline) as Array<keyof T>,
  ]);
  return [...keys].some((key) => draft[key] !== baseline[key]);
}
