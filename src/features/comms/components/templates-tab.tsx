"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EmailTemplateRow } from "@/features/comms";
import { TEMPLATE_KEYS, type EventId, type TemplateKey } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { useGuardedAction, useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { Button, Field, Switch } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { useSaveTemplate, useTemplates } from "../hooks/use-templates";
import { useTemplatePreview } from "../hooks/use-template-preview";
import { MessagePreview } from "./message-preview";
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
  useUnsavedWorkGuard(dirty);
  const { runGuarded } = useGuardedAction();

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
      toast("Could not save that template", { kind: "error" });
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
          <button key={row.key} type="button" aria-pressed={row.key === selectedKey} className={row.key === selectedKey ? "active" : ""} onClick={() => {
            if (row.key !== selectedKey) runGuarded(() => selectKey(row.key));
          }}>
            <i className={row.enabled ? "enabled" : ""} />
            {humanizeKey(row.key)}
          </button>
        ))}
      </nav>
      <div className="template-editor">
        <header className="template-editor-header">
          <div>
            <span className="page-eyebrow">Email template</span>
            <h2>{humanizeKey(selectedKey)}</h2>
            <p>Changes affect every future message that uses this template.</p>
          </div>
          <span className={`template-state ${enabled ? "is-enabled" : ""}`}>{enabled ? "Enabled" : "Paused"}</span>
        </header>
        {staleConflict && (
          <div className="stale-write-banner">
            <span>This template changed since you loaded it.</span>
            <Button size="sm" onClick={() => runGuarded(() => { void reload(); })}>Reload</Button>
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
            <div className="template-editor-actions">
              <div className="inline-setting template-enabled-setting">
                <div><b>Enabled</b><small>Allow this template to send when its trigger runs</small></div>
                <Switch label={`${humanizeKey(selectedKey)} enabled`} checked={enabled} onClick={() => { setEnabled((current) => !current); setDirty(true); }} />
              </div>
              <Button onClick={() => void onSave()} disabled={unknownTokens.length > 0 || save.isPending || !dirty}>
                {save.isPending ? "Saving…" : "Save template"}
              </Button>
            </div>
          </div>
          <MessagePreview
            label="LIVE PREVIEW"
            hint="Updates as you type"
            message={unknownTokens.length === 0 && preview.data
              ? { subject: preview.data.subject, bodyHtml: preview.data.html, bodyText: preview.data.text }
              : undefined}
            status={unknownTokens.length > 0
              ? "Fix the unknown variable to see a preview."
              : preview.isPending
                ? "Rendering…"
                : preview.isError
                  ? "Preview unavailable."
                  : undefined}
          />
        </div>
      </div>
    </div>
  );
}
