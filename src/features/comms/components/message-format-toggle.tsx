"use client";

export type MessageFormat = "html" | "text";

/**
 * The one HTML/Plain-text switch in the product. Template editing, bulk
 * compose and the delivery log's message detail all show an email that ships
 * with a `text/plain` alternative beside its HTML, and an organizer checking
 * what a recipient received deserves the same two views on every one of them.
 *
 * The panes stay mounted and `hidden`, addressed by `aria-controls`, so the
 * switch never remounts the body it is describing.
 */
export function MessageFormatToggle({ format, label = "Preview format", htmlPanelId, textPanelId, onChange }: {
  format: MessageFormat;
  label?: string;
  htmlPanelId: string;
  textPanelId: string;
  onChange: (format: MessageFormat) => void;
}) {
  return (
    <div className="template-preview-format" role="group" aria-label={label}>
      <button
        type="button"
        aria-pressed={format === "html"}
        aria-controls={htmlPanelId}
        onClick={() => onChange("html")}
      >
        HTML
      </button>
      <button
        type="button"
        aria-pressed={format === "text"}
        aria-controls={textPanelId}
        onClick={() => onChange("text")}
      >
        Plain text
      </button>
    </div>
  );
}
