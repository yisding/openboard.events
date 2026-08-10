"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EmailTemplateRow } from "@/features/comms";
import { TEMPLATE_KEYS, type EventId, type TemplateKey } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { Button, Field } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { useSaveTemplate, useTemplates } from "../hooks/use-templates";
import { useTemplatePreview } from "../hooks/use-template-preview";
import { templateVariablePaths } from "./sample-vars";
import { unknownTokensClientSide } from "./validate-client";

function humanizeKey(key: TemplateKey): string {
  return key.replaceAll("_", " ").replace(/^./u, (c) => c.toUpperCase());
}

type FocusTarget = "subject" | "body";
const PREVIEW_DEBOUNCE_MS = 400;

/**
 * Templates tab (step 3). The body field is a plain `<textarea>`, not
 * `<RichTextEditor>` — deliberately, per this module's documented fallback
 * (work order "If blocked": "ship the textarea variant — the value contract
 * is identical"). TipTap's `RichTextEditor` exposes no cursor API to a
 * parent, so the chip picker's "insert `{{path}}` at the cursor" behavior is
 * unreachable through it; a `<textarea>` gives that for free via
 * `selectionStart`/`selectionEnd`, and the stored value is still sanitized
 * HTML server-side either way.
 */
export function TemplatesTab({ eventId, initialData }: { eventId: EventId; initialData: EmailTemplateRow[] }) {
  const { toast } = useToast();
  const query = useTemplates(eventId, initialData);
  const save = useSaveTemplate(eventId);
  const preview = useTemplatePreview(eventId);
  const templates = query.data ?? initialData;
  const [selectedKey, setSelectedKey] = useState<TemplateKey>(templates[0]?.key ?? TEMPLATE_KEYS[0]);
  const selected = templates.find((row) => row.key === selectedKey);

  const [subject, setSubject] = useState(selected?.subject ?? "");
  const [bodyHtml, setBodyHtml] = useState(selected?.bodyHtml ?? "");
  const [enabled, setEnabled] = useState(selected?.enabled ?? true);
  const [dirty, setDirty] = useState(false);
  const [staleConflict, setStaleConflict] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  function selectKey(key: TemplateKey) {
    const row = templates.find((item) => item.key === key);
    setSelectedKey(key);
    setSubject(row?.subject ?? "");
    setBodyHtml(row?.bodyHtml ?? "");
    setEnabled(row?.enabled ?? true);
    setDirty(false);
    setStaleConflict(false);
  }

  const variablePaths = useMemo(() => templateVariablePaths(selectedKey), [selectedKey]);
  const unknownTokens = useMemo(() => unknownTokensClientSide(selectedKey, subject, bodyHtml), [selectedKey, subject, bodyHtml]);

  // A ref, not `preview.mutate` itself, in the effect's dependency array:
  // the mutation object's identity is free to change on every status update,
  // and this effect must fire on *content* changes only, not on that churn.
  const previewMutateRef = useRef(preview.mutate);
  previewMutateRef.current = preview.mutate;

  // Re-rendered on change (debounced), against a fixture context — a round
  // trip because the renderer lives behind the Drizzle schema graph and this
  // is a "use client" component (see the preview route's docstring).
  useEffect(() => {
    if (unknownTokens.length > 0) return;
    const timer = window.setTimeout(() => {
      previewMutateRef.current({ key: selectedKey, subject, bodyHtml });
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [selectedKey, subject, bodyHtml, unknownTokens.length]);

  function insertToken(path: string) {
    const token = `{{${path}}}`;
    setDirty(true);
    if (focusTarget === "subject") {
      const el = subjectRef.current;
      const start = el?.selectionStart ?? subject.length;
      const end = el?.selectionEnd ?? subject.length;
      const next = `${subject.slice(0, start)}${token}${subject.slice(end)}`;
      setSubject(next);
      requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + token.length, start + token.length); });
    } else {
      const el = bodyRef.current;
      const start = el?.selectionStart ?? bodyHtml.length;
      const end = el?.selectionEnd ?? bodyHtml.length;
      const next = `${bodyHtml.slice(0, start)}${token}${bodyHtml.slice(end)}`;
      setBodyHtml(next);
      requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + token.length, start + token.length); });
    }
  }

  async function onSave() {
    if (!selected) return;
    setStaleConflict(false);
    try {
      await save.mutateAsync({ key: selectedKey, subject, bodyHtml, enabled, expectedUpdatedAt: selected.updatedAt });
      setDirty(false);
      toast(`${humanizeKey(selectedKey)} saved`);
    } catch (error) {
      if (isAppError(error) && error.code === "STALE_WRITE") { setStaleConflict(true); return; }
      if (isAppError(error) && error.code === "TEMPLATE_VAR_MISSING") return; // the inline warning already covers this
      toast("Could not save that template");
    }
  }

  async function reload() {
    const fresh = await query.refetch();
    const row = fresh.data?.find((item) => item.key === selectedKey);
    if (row) { setSubject(row.subject); setBodyHtml(row.bodyHtml); setEnabled(row.enabled); }
    setDirty(false);
    setStaleConflict(false);
  }

  if (!selected) return <p className="long-copy">This event has no templates yet.</p>;

  return (
    <div className="comms-templates">
      <nav className="comms-rail" aria-label="Template keys">
        {templates.map((row) => (
          <button key={row.key} type="button" className={row.key === selectedKey ? "active" : ""} onClick={() => selectKey(row.key)}>
            <i className={row.enabled ? "enabled" : ""} />
            {humanizeKey(row.key)}
          </button>
        ))}
      </nav>
      <div className="template-editor">
        {staleConflict && (
          <div className="stale-write-banner">
            <span>This template changed since you loaded it.</span>
            <Button size="sm" onClick={() => void reload()}>Reload</Button>
          </div>
        )}
        <div className="template-editor-grid">
          <div className="form-stack">
            <Field label="Subject">
              <input
                ref={subjectRef}
                value={subject}
                onFocus={() => setFocusTarget("subject")}
                onChange={(event) => { setSubject(event.target.value); setDirty(true); }}
              />
            </Field>
            <Field label="Email body" hint="Plain HTML; tags like <p>, <strong>, <a href> survive sanitization on save.">
              <textarea
                ref={bodyRef}
                value={bodyHtml}
                onFocus={() => setFocusTarget("body")}
                onChange={(event) => { setBodyHtml(event.target.value); setDirty(true); }}
              />
            </Field>
            <div className="template-vars">
              {variablePaths.map((path) => <button key={path} type="button" onClick={() => insertToken(path)}>{`{{${path}}}`}</button>)}
            </div>
            {unknownTokens.length > 0 && (
              <p className="unknown-token-warning">
                Unknown variable {unknownTokens.map((token) => `{{${token}}}`).join(", ")} — remove it or pick from the list above.
              </p>
            )}
            <label className="checkbox-row">
              <input type="checkbox" checked={enabled} onChange={(event) => { setEnabled(event.target.checked); setDirty(true); }} />
              Enabled
            </label>
            <Button onClick={() => void onSave()} disabled={unknownTokens.length > 0 || save.isPending || !dirty}>
              {save.isPending ? "Saving…" : "Save template"}
            </Button>
          </div>
          <aside className="template-editor__preview">
            <span>LIVE PREVIEW</span>
            {unknownTokens.length > 0 && <p className="long-copy">Fix the unknown variable to see a preview.</p>}
            {unknownTokens.length === 0 && preview.isPending && <p className="long-copy">Rendering…</p>}
            {unknownTokens.length === 0 && preview.data && <><b>{preview.data.subject || "(empty subject)"}</b><RichTextView html={preview.data.html} /></>}
            {unknownTokens.length === 0 && preview.isError && <p className="long-copy">Preview unavailable.</p>}
          </aside>
        </div>
      </div>
    </div>
  );
}
