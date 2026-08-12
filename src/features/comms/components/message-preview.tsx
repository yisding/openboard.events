import { RichTextView } from "@/shared/ui/app/rich-text-view";

type MessagePreviewProps = {
  label: string;
  hint: string;
  message?: { subject: string; bodyHtml: string } | null | undefined;
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
  return (
    <aside className="template-editor__preview message-preview" aria-live="polite">
      <header className="template-preview-heading">
        <span>{label}</span>
        <small>{hint}</small>
      </header>
      {message && (
        <article className="template-preview-message">
          <header className="template-preview-subject">
            <small>Subject</small>
            <b>{message.subject || "(empty subject)"}</b>
          </header>
          <div className="template-preview-body">
            <RichTextView html={message.bodyHtml} />
          </div>
        </article>
      )}
      {status && <p className="template-preview-status">{status}</p>}
    </aside>
  );
}
