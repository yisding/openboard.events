const INTERNAL_ORIGIN = "https://openboard.invalid";

export function safeInternalPath(value: string | null | undefined, fallback = "/events"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("\\") || /%(?:2f|5c)/iu.test(value) || /[\u0000-\u001f\u007f]/u.test(value)) return fallback;
  try {
    const parsed = new URL(value, INTERNAL_ORIGIN);
    if (parsed.origin !== INTERNAL_ORIGIN) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
