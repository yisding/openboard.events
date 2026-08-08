export const RESERVED_SLUGS = ["api", "submit", "admin", "portal", "e", "embed", "assets", "app", "cal", "f", "login"] as const;

export function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
}
