"use client";

import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { Bold, Code, Italic, Link2, List, ListOrdered, Quote, Underline as UnderlineIcon } from "lucide-react";
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { plainTextLength } from "@/shared/contracts";
import { cn } from "@/shared/lib/cn";
import { sanitize } from "@/shared/lib/sanitize";
import { Button, Field, Modal } from "@/shared/ui/ui-kit";
import { richTextLinkError } from "./rich-text-link";

/**
 * The toolbar is deliberately the sanitizer's allowlist and nothing more. No
 * image node, no table, no colours: anything the sanitizer strips must not be
 * offerable, or an organizer writes something that silently disappears on save.
 *
 * `onChange` emits **sanitized HTML**, not TipTap JSON — the stored value is the
 * same shape every render surface reads.
 *
 * `value` is a real controlled prop: TipTap only reads `content` when it builds
 * the instance, so a caller that replaces the value from outside the editor
 * (restoring a revision, say) is pushed into the live document by hand.
 *
 * Loaded through `next/dynamic` with `ssr: false` by `rich-text-editor-lazy` so
 * TipTap never enters the server graph.
 */
export type RichTextEditorHandle = {
  /** Insert plain text at the current selection and restore editor focus. */
  insertAtCursor: (text: string) => boolean;
};

export type RichTextEditorProps = {
  value: string;
  onChange: (html: string) => void;
  /** Defaults to the shared allowlist; feature editors may preserve safe placeholders. */
  sanitizeHtml?: (html: string) => string;
  maxChars?: number;
  placeholder?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  required?: boolean;
  disabled?: boolean;
};

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor({
  value,
  onChange,
  sanitizeHtml = sanitize,
  maxChars,
  placeholder,
  ariaLabel = "Rich text editor",
  ariaLabelledBy,
  ariaDescribedBy,
  ariaInvalid = false,
  required = false,
  disabled = false,
}, ref) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("");
  const [linkError, setLinkError] = useState("");
  const [editingLink, setEditingLink] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const linkErrorId = useId();
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // Everything the sanitizer would strip is off, so the toolbar cannot
        // offer formatting that does not survive a save.
        horizontalRule: false,
        strike: false,
        link: false,
      }),
      Link.configure({ openOnClick: false, autolink: false, protocols: ["http", "https", "mailto"] }),
      ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    ],
    content: value,
    editable: !disabled,
    editorProps: {
      attributes: {
        class: "rich-text-editor__surface",
        role: "textbox",
        "aria-multiline": "true",
        ...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : { "aria-label": ariaLabel }),
        ...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {}),
        ...(ariaInvalid ? { "aria-invalid": "true" } : {}),
        ...(required ? { "aria-required": "true" } : {}),
      },
    },
    onUpdate: ({ editor: instance }) => onChange(sanitizeHtml(instance.getHTML())),
  });

  // `useEditor` never rebuilds the instance for a changed `content`, and
  // `setOptions` only merges options — without this the document keeps whatever
  // it was seeded with, and the writer's next keystroke emits that stale HTML
  // back to the caller, silently undoing whatever the caller had just set.
  //
  // Guarded by a sanitize-and-compare because the common case is the editor's
  // own `onChange` arriving back as `value`: re-parsing on every keystroke would
  // rebuild the document and drop the cursor mid-word. `emitUpdate: false` keeps
  // an externally driven change from firing `onChange` straight back out.
  useEffect(() => {
    if (!editor) return;
    const current = sanitizeHtml(editor.getHTML());
    if (current === value) return;
    // An empty document round-trips as `<p></p>`, which callers that store "no
    // answer" as `""` would otherwise re-seed on every emptying keystroke.
    if (plainTextLength(current) === 0 && plainTextLength(value) === 0) return;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, sanitizeHtml, value]);

  // `emitUpdate: false` — TipTap's `setEditable` fires a synthetic `update`
  // by default, and this effect runs on mount. Left on, every editor emitted
  // `onChange` the moment it appeared, and callers that read an `onChange` as
  // "the organizer typed" armed their unsaved-work guard against a page nobody
  // had touched. Editability is not a content change.
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [disabled, editor]);

  useImperativeHandle(ref, () => ({
    insertAtCursor(text: string) {
      if (!editor || disabled) return false;
      // A text node prevents a token containing punctuation from ever being
      // interpreted as source markup by TipTap's string-content parser.
      return editor.chain().focus().insertContent({ type: "text", text }).run();
    },
  }), [disabled, editor]);

  const openLinkDialog = useCallback(() => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    setLinkHref(previous ?? "https://");
    setEditingLink(Boolean(previous));
    setLinkError("");
    setLinkOpen(true);
  }, [editor]);

  const closeLinkDialog = useCallback(() => {
    setLinkOpen(false);
    setLinkError("");
  }, []);

  const applyLink = useCallback(() => {
    if (!editor) return;
    const error = richTextLinkError(linkHref);
    if (error) {
      setLinkError(error);
      return;
    }
    const href = linkHref.trim();
    closeLinkDialog();
    window.requestAnimationFrame(() => editor.chain().focus().setLink({ href }).run());
  }, [closeLinkDialog, editor, linkHref]);

  const removeLink = useCallback(() => {
    if (!editor) return;
    closeLinkDialog();
    window.requestAnimationFrame(() => editor.chain().focus().unsetLink().run());
  }, [closeLinkDialog, editor]);

  if (!editor) return <div className="rich-text-editor rich-text-editor--loading" aria-busy="true" />;

  // The same function the server's .refine() uses, so the count a writer sees and
  // the count that rejects their save cannot drift.
  const used = plainTextLength(editor.getHTML());
  const over = maxChars !== undefined && used > maxChars;

  const button = (key: string, label: string, icon: React.ReactNode, run: () => void, active?: boolean) => (
    <button
      key={key}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ?? false}
      disabled={disabled}
      className={cn("rich-text-editor__tool", active && "is-active")}
      onClick={run}
    >
      {icon}
    </button>
  );

  return (
    <div
      className={cn("rich-text-editor", over && "is-over-limit", disabled && "is-disabled")}
      aria-disabled={disabled || undefined}
    >
      <div className="rich-text-editor__toolbar" role="toolbar" aria-label="Formatting">
        {button("bold", "Bold", <Bold size={14} />, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
        {button("italic", "Italic", <Italic size={14} />, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
        {button("underline", "Underline", <UnderlineIcon size={14} />, () => editor.chain().focus().toggleUnderline().run(), editor.isActive("underline"))}
        {button("h2", "Heading", <span className="rich-text-editor__h">H2</span>, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
        {button("bullet", "Bulleted list", <List size={14} />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
        {button("ordered", "Numbered list", <ListOrdered size={14} />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
        {button("quote", "Quote", <Quote size={14} />, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"))}
        {button("code", "Code", <Code size={14} />, () => editor.chain().focus().toggleCode().run(), editor.isActive("code"))}
        {button("link", "Link", <Link2 size={14} />, openLinkDialog, editor.isActive("link"))}
      </div>
      <EditorContent editor={editor} />
      {maxChars !== undefined && (
        <div className={cn("rich-text-editor__count", over && "is-over")} aria-live="polite">
          {used} / {maxChars}
        </div>
      )}
      <Modal
        open={linkOpen}
        onClose={closeLinkDialog}
        title={editingLink ? "Edit link" : "Add link"}
        description="Use an http, https, or mailto address."
        initialFocusRef={linkInputRef}
        footer={<>
          {editingLink && <Button variant="ghost" onClick={removeLink}>Remove link</Button>}
          <Button variant="secondary" onClick={closeLinkDialog}>Cancel</Button>
          <Button onClick={applyLink}>{editingLink ? "Update link" : "Add link"}</Button>
        </>}
      >
        <div className="form-stack">
          <Field label="Link URL" required error={linkError} errorId={linkErrorId}>
            <input
              ref={linkInputRef}
              type="text"
              inputMode="url"
              required
              aria-invalid={Boolean(linkError) || undefined}
              aria-describedby={linkError ? linkErrorId : undefined}
              value={linkHref}
              onChange={(event) => { setLinkHref(event.target.value); setLinkError(""); }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                event.stopPropagation();
                applyLink();
              }}
              placeholder="https://example.com"
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
});
