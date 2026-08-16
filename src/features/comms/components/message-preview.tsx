"use client";

import { useId, useState } from "react";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { MessageFormatToggle } from "./message-format-toggle";

type MessagePreviewProps = {
  label: string;
  hint: string;
  message?: { subject: string; bodyHtml: string; bodyText?: string } | null | undefined;
  status?: string | undefined;
};

/**
 * The shared email preview used by template editing and bulk compose.
 *
 * The preview chrome is one compact row; subject metadata and message content
 * then form one continuous surface below it. Keeping those layers together
 * avoids the old stack of heading text, grid gap, inset card, and card padding
 * that made the subject look detached from the LIVE PREVIEW label.
 */
export function MessagePreview({ label, hint, message, status }: MessagePreviewProps) {
  const [format, setFormat] = useState<"html" | "text">("html");
  const id = useId();
  const hasPlainText = message?.bodyText !== undefined;
  const activeFormat = hasPlainText ? format : "html";

  return (
    <aside className="template-editor__preview message-preview" aria-live="polite">
      <header className="template-preview-heading">
        <span>{label}</span>
        <small>{hint}</small>
      </header>
      {message && (
        <article className="template-preview-message">
          <header className="template-preview-subject">
            <div className="template-preview-subject-copy">
              <small>Subject</small>
              <b>{message.subject || "(empty subject)"}</b>
            </div>
            {hasPlainText && (
              <MessageFormatToggle
                format={activeFormat}
                htmlPanelId={`${id}-html`}
                textPanelId={`${id}-text`}
                onChange={setFormat}
              />
            )}
          </header>
          <div id={`${id}-html`} className="template-preview-body" hidden={activeFormat !== "html"}>
            <RichTextView html={message.bodyHtml} />
          </div>
          {hasPlainText && (
            <div id={`${id}-text`} className="template-preview-body template-preview-plain-text" hidden={activeFormat !== "text"}>
              <pre>{message.bodyText || "(empty plain-text body)"}</pre>
            </div>
          )}
        </article>
      )}
      {status && <p className="template-preview-status">{status}</p>}
    </aside>
  );
}
