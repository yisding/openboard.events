import { sanitizeTemplateBody } from "@/features/comms/template-body";

export type TemplateBodyMode = "rich" | "html";

/**
 * HTML source stays literal while it is being edited. Re-entering the visual
 * editor crosses the same narrow sanitizer boundary used by email rendering,
 * so TipTap never receives markup the product would later discard.
 */
export function templateBodyForMode(bodyHtml: string, nextMode: TemplateBodyMode): string {
  return nextMode === "rich" ? sanitizeTemplateBody(bodyHtml) : bodyHtml;
}
