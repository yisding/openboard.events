"use client";

import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { Bold, Code, Italic, Link2, List, ListOrdered, Quote, Underline as UnderlineIcon } from "lucide-react";
import { useCallback } from "react";
import { plainTextLength } from "@/shared/contracts";
import { cn } from "@/shared/lib/cn";
import { sanitize } from "@/shared/lib/sanitize";

/**
 * The toolbar is deliberately the sanitizer's allowlist and nothing more. No
 * image node, no table, no colours: anything the sanitizer strips must not be
 * offerable, or an organizer writes something that silently disappears on save.
 *
 * `onChange` emits **sanitized HTML**, not TipTap JSON — the stored value is the
 * same shape every render surface reads.
 *
 * Loaded through `next/dynamic` with `ssr: false` by `rich-text-editor-lazy` so
 * TipTap never enters the server graph.
 */
export function RichTextEditor({
  value,
  onChange,
  maxChars,
  placeholder,
  ariaLabel = "Rich text editor",
}: {
  value: string;
  onChange: (html: string) => void;
  maxChars?: number;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // Everything the sanitizer would strip is off, so the toolbar cannot
        // offer formatting that does not survive a save.
        horizontalRule: false,
        codeBlock: false,
        strike: false,
        link: false,
      }),
      Underline,
      Link.configure({ openOnClick: false, autolink: false, protocols: ["http", "https", "mailto"] }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "rich-text-editor__surface",
        "aria-label": ariaLabel,
        ...(placeholder ? { "data-placeholder": placeholder } : {}),
      },
    },
    onUpdate: ({ editor: instance }) => onChange(sanitize(instance.getHTML())),
  });

  const addLink = useCallback(() => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const entered = window.prompt("Link URL", previous ?? "https://");
    if (entered === null) return;
    if (entered === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    // Anything but http(s) and mailto is a script-URL vector; refuse before insert
    // rather than relying on the sanitizer to clean up after.
    if (!/^(https?:|mailto:)/i.test(entered)) {
      window.alert("Links must start with http://, https:// or mailto:");
      return;
    }
    editor.chain().focus().setLink({ href: entered }).run();
  }, [editor]);

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
      className={cn("rich-text-editor__tool", active && "is-active")}
      onClick={run}
    >
      {icon}
    </button>
  );

  return (
    <div className={cn("rich-text-editor", over && "is-over-limit")}>
      <div className="rich-text-editor__toolbar" role="toolbar" aria-label="Formatting">
        {button("bold", "Bold", <Bold size={14} />, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
        {button("italic", "Italic", <Italic size={14} />, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
        {button("underline", "Underline", <UnderlineIcon size={14} />, () => editor.chain().focus().toggleUnderline().run(), editor.isActive("underline"))}
        {button("h2", "Heading", <span className="rich-text-editor__h">H2</span>, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
        {button("bullet", "Bulleted list", <List size={14} />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
        {button("ordered", "Numbered list", <ListOrdered size={14} />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
        {button("quote", "Quote", <Quote size={14} />, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"))}
        {button("code", "Code", <Code size={14} />, () => editor.chain().focus().toggleCode().run(), editor.isActive("code"))}
        {button("link", "Link", <Link2 size={14} />, addLink, editor.isActive("link"))}
      </div>
      <EditorContent editor={editor} />
      {maxChars !== undefined && (
        <div className={cn("rich-text-editor__count", over && "is-over")} aria-live="polite">
          {used} / {maxChars}
        </div>
      )}
    </div>
  );
}
