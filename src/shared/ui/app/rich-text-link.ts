export function richTextLinkError(href: string): string {
  const value = href.trim();
  if (!value) return "Enter a link URL.";
  return /^(https?:|mailto:)/iu.test(value)
    ? ""
    : "Use an http://, https://, or mailto: link.";
}
