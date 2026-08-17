"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { StaleWriteNotice, staleWriteConfirm } from "@/shared/ui/app/stale-write";
import { editorDraftChanged, requestGuardedEditorClose } from "@/shared/ui/app/modal-editor-guard";
import { useGuardedAction, useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { moveRovingTab } from "@/shared/ui/app/roving-tabs";
import { Button, Field, Modal, Switch } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { createStableCreateRequestId } from "@/shared/lib/stable-create-request-id";
import { slugify } from "@/shared/lib/slug";
import { readFieldErrors } from "@/shared/lib/api-client";
import type { ResourcePageDTO } from "../server/queries";

const BODY_MODES = ["rich", "source"] as const;

export type ResourcePageDraft = {
  id?: string;
  title: string;
  slug: string;
  bodyHtml: string;
  published: boolean;
};

function draftFromPage(page: ResourcePageDTO | null): ResourcePageDraft {
  if (!page) return { title: "", slug: "", bodyHtml: "", published: true };
  return { id: page.id, title: page.title, slug: page.slug, bodyHtml: page.bodyHtml ?? "", published: page.published };
}

export function focusResourceFieldError(
  container: { querySelector: (selector: string) => { focus: () => void } | null } | null,
  schedule: (callback: () => void) => unknown = (callback) => window.requestAnimationFrame(callback),
) {
  schedule(() => container?.querySelector('[aria-invalid="true"]')?.focus());
}

export async function recoverStaleResourcePage(
  reload: () => void | Promise<void>,
  onFailure: () => void,
): Promise<boolean> {
  try {
    await reload();
    return true;
  } catch {
    onFailure();
    return false;
  }
}

/**
 * Create/edit a resource page. The rich text toolbar never offers an iframe —
 * `RichTextEditor` sanitizes with the narrow `default` profile on every
 * keystroke — so "HTML source" is the *only* way an organizer pastes a video
 * or map embed. That toggle is not a stopgap for a missing editor; it is kept
 * permanently, per the work order, because it is the honest UX for embed
 * support. Whichever mode was last active is what gets sanitized with the
 * `wide` profile server-side on save.
 */
export function ResourcePageEditor({
  eventId,
  eventSlug,
  open,
  page,
  onClose,
  onSaved,
}: {
  eventId: string;
  eventSlug: string;
  open: boolean;
  page: ResourcePageDTO | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const formRef = useRef<HTMLDivElement>(null);
  const initialDraft = draftFromPage(page);
  const [draft, setDraft] = useState<ResourcePageDraft>(initialDraft);
  const [baseline, setBaseline] = useState<ResourcePageDraft>(initialDraft);
  const [slugTouched, setSlugTouched] = useState(Boolean(page));
  const [mode, setMode] = useState<(typeof BODY_MODES)[number]>("rich");
  const [saving, setSaving] = useState(false);
  /**
   * Somebody else's edit landed first. The draft stays exactly where it is —
   * this used to toast "please re-apply your edit" and then close the modal,
   * which threw the edit away in the same breath as asking for it back. The
   * task editor beside this one has always kept its draft and offered "Load
   * latest"; this now does the same.
   */
  const [stale, setStale] = useState(false);
  const [confirmingLoadLatest, setConfirmingLoadLatest] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const createRequestId = useRef(createStableCreateRequestId());
  const { runGuarded } = useGuardedAction();
  const dirty = open && editorDraftChanged(draft, baseline);
  useUnsavedWorkGuard(dirty);

  useEffect(() => {
    if (!open) {
      createRequestId.current.reset();
      return;
    }
    if (page) createRequestId.current.reset();
    else createRequestId.current.begin();
    const nextDraft = draftFromPage(page);
    setDraft(nextDraft);
    setBaseline(nextDraft);
    setSlugTouched(Boolean(page));
    setMode("rich");
    setFieldErrors({});
    // Reopening, or loading the latest, clears the banner along with the draft
    // it was protecting.
    setStale(false);
  }, [open, page]);

  function setTitle(title: string) {
    setDraft((current) => ({ ...current, title, slug: slugTouched ? current.slug : slugify(title) }));
    clearFieldError("title");
  }

  function setSlug(slug: string) {
    setSlugTouched(true);
    setDraft((current) => ({ ...current, slug: slug.toLowerCase() }));
    clearFieldError("slug");
  }

  function clearFieldError(field: string) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function discardEditor() {
    createRequestId.current.reset();
    onClose();
  }

  function closeEditor() {
    requestGuardedEditorClose({ busy: saving, dirty, runGuarded, close: discardEditor });
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setFieldErrors({});
    try {
      const response = await fetch(
        draft.id ? `/api/internal/resources/${eventId}/${draft.id}` : `/api/internal/resources/${eventId}`,
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(createRequestId.current.payload(draft.id, {
            title: draft.title,
            ...(draft.slug ? { slug: draft.slug } : {}),
            bodyHtml: draft.bodyHtml,
            published: draft.published,
            ...(page ? { expectedUpdatedAt: page.updatedAt } : {}),
          })),
        },
      );
      const payload = await response.json().catch(() => null) as {
        error?: { code?: string; message?: string; fieldErrors?: Record<string, string>; data?: { fieldErrors?: Record<string, string> } };
      } | null;
      if (response.status === 409 || payload?.error?.code === "STALE_WRITE") {
        // Not an error the organizer caused, and not one they can fix by saving
        // again: somebody else's edit landed first. Say so, and keep every word
        // they have typed — closing the modal here discarded the rewrite the
        // toast was asking them to re-apply.
        setStale(true);
        toast("This page changed since you opened it. Your draft is still here.", { kind: "error" });
        return;
      }
      if (!response.ok) {
        const nextFieldErrors = readFieldErrors(payload?.error) ?? {};
        setFieldErrors(nextFieldErrors);
        if (Object.keys(nextFieldErrors).length > 0) focusResourceFieldError(formRef.current);
        toast(payload?.error?.message ?? "That page could not be saved", { kind: "error" });
        return;
      }
      toast(draft.id ? "Page updated" : "Page created");
      setBaseline(draft);
      await onSaved();
      createRequestId.current.reset();
    } catch {
      toast("That page could not be saved", { kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <Modal
      open={open}
      onClose={closeEditor}
      title={draft.id ? "Edit resource page" : "New resource page"}
      description="Speakers see this in the portal once it is published."
      wide
      footer={<>
        <Button variant="secondary" onClick={closeEditor} disabled={saving}>Cancel</Button>
        <Button disabled={!draft.title.trim() || saving || stale} onClick={save}>{saving ? "Saving…" : draft.id ? "Save changes" : "Create page"}</Button>
      </>}
    >
      {stale && <StaleWriteNotice subject="page" busy={saving} onLoadLatest={() => setConfirmingLoadLatest(true)} />}
      <div ref={formRef} className="form-stack" inert={saving || undefined} aria-busy={saving || undefined}>
        <Field label="Title" required error={fieldErrors.title} errorId="resource-title-error">
          <input required aria-invalid={Boolean(fieldErrors.title) || undefined} aria-describedby={fieldErrors.title ? "resource-title-error" : undefined} value={draft.title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Speaker Guide" />
        </Field>

        <Field label="URL" hint={`…/resources/${draft.slug || "…"}`} hintId="resource-slug-hint" error={fieldErrors.slug} errorId="resource-slug-error">
          <input aria-invalid={Boolean(fieldErrors.slug) || undefined} aria-describedby={fieldErrors.slug ? "resource-slug-error" : "resource-slug-hint"} value={draft.slug} onChange={(event) => setSlug(event.target.value)} placeholder="speaker-guide" />
        </Field>

        <Field label="Body" group>
          <div className="rich-text-mode-toggle" role="tablist" aria-label="Body editing mode">
            <button type="button" role="tab" id="resource-body-tab-rich" aria-controls="resource-body-panel" aria-selected={mode === "rich"} tabIndex={mode === "rich" ? 0 : -1} className={mode === "rich" ? "active" : ""} onKeyDown={(event) => moveRovingTab(event, BODY_MODES, "rich", setMode)} onClick={() => setMode("rich")}>Rich text</button>
            <button type="button" role="tab" id="resource-body-tab-source" aria-controls="resource-body-panel" aria-selected={mode === "source"} tabIndex={mode === "source" ? 0 : -1} className={mode === "source" ? "active" : ""} onKeyDown={(event) => moveRovingTab(event, BODY_MODES, "source", setMode)} onClick={() => setMode("source")}>HTML source</button>
          </div>
          <div id="resource-body-panel" role="tabpanel" aria-labelledby={`resource-body-tab-${mode}`}>
            {mode === "rich"
              ? <RichTextEditor ariaLabel="Resource page body" value={draft.bodyHtml} onChange={(html) => setDraft((current) => ({ ...current, bodyHtml: html }))} placeholder="Write the page…" />
              : (
                <textarea
                  className="html-source-editor"
                  value={draft.bodyHtml}
                  onChange={(event) => setDraft((current) => ({ ...current, bodyHtml: event.target.value }))}
                  placeholder='<iframe src="https://www.youtube.com/embed/…" allowfullscreen></iframe>'
                  spellCheck={false}
                  aria-label="HTML source"
                />
              )}
          </div>
          <p className="field-note">
            HTML source is the only place to paste a video or map embed — the rich text toolbar never offers one.
            Both are sanitized on save and again on render: script tags and event handlers are always stripped, and
            an iframe survives only with an https:// source from an allowlisted host (YouTube, Vimeo, Loom, Google Docs).
          </p>
        </Field>

        <label className="inline-setting">
          <div><b>Published</b><small>Unpublished pages are invisible in the portal — organizers only.</small></div>
          <Switch
            label="Published"
            checked={draft.published}
            onClick={() => setDraft((current) => ({ ...current, published: !current.published }))}
          />
        </label>

        {draft.id && draft.slug && (
          <a className="resource-editor-preview-link" href={`/portal/${eventSlug}/resources/${draft.slug}`} target="_blank" rel="noreferrer">
            View in portal ↗
          </a>
        )}
      </div>
    </Modal>
    <ConfirmDialog
      open={confirmingLoadLatest}
      {...staleWriteConfirm("page")}
      onConfirm={async () => {
        await recoverStaleResourcePage(onSaved, () => {
          toast("The latest page could not be reloaded. Refresh the browser before editing it again.", { kind: "error" });
        });
        setConfirmingLoadLatest(false);
      }}
      onCancel={() => setConfirmingLoadLatest(false)}
    />
    </>
  );
}
