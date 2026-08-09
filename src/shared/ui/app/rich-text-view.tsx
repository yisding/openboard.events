import { sanitize } from "@/shared/lib/sanitize";

export function RichTextView({ html, wide = false, className = "" }: { html: string; wide?: boolean; className?: string }) {
  return <div className={`rich-text ${className}`} dangerouslySetInnerHTML={{ __html: sanitize(html, { profile: wide ? "wide" : "default" }) }} />;
}
