export function richTextLinkError(href: string): string {
  const value = href.trim();
  if (!value) return "Enter a link URL.";

  if (/^mailto:/iu.test(value)) {
    return value.slice(value.indexOf(":") + 1).trim() && !/\s/u.test(value)
      ? ""
      : "Enter a complete link URL.";
  }

  if (/^https?:/iu.test(value)) {
    try {
      return new URL(value).hostname ? "" : "Enter a complete link URL.";
    } catch {
      return "Enter a complete link URL.";
    }
  }

  return "Use an http://, https://, or mailto: link.";
}
