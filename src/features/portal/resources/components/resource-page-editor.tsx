"use client";

import { useEffect, useState } from "react";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { Button, Field, Modal } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { slugify } from "@/shared/lib/slug";
import type { ResourcePageDTO } from "../server/queries";

export type ResourcePageDraft = {
  id?: string;
  title: string;
  slug: string;
  bodyHtml: string;
  published: boolean;
};

/**
 * `Field.hint` is `hint?: string` under `exactOptionalPropertyTypes` — the prop
 * may be omitted, but never explicitly set to `undefined`. Same helper as
 * `tasks-admin`'s `TaskEditor`.
 */
function hintProp(hint: string | undefined): { hint: string } | Record<string, never> {
  return hint ? { hint } : {};
}

function draftFromPage(page: ResourcePageDTO | null): ResourcePageDraft {
  if (!page) return { title: "", slug: "", bodyHtml: "", published: true };
  return { id: page.id, title: page.title, slug: page.slug, bodyHtml: page.bodyHtml ?? "", published: page.published };
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
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<ResourcePageDraft>(() => draftFromPage(page));
  const [slugTouched, setSlugTouched] = useState(Boolean(page));
  const [mode, setMode] = useState<"rich" | "source">("rich");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setDraft(draftFromPage(page));
      setSlugTouched(Boolean(page));
      setMode("rich");
      setFieldErrors({});
    }
  }, [open, page]);

  function setTitle(title: string) {
    setDraft((current) => ({ ...current, title, slug: slugTouched ? current.slug : slugify(title) }));
  }

  function setSlug(slug: string) {
    setSlugTouched(true);
    setDraft((current) => ({ ...current, slug: slug.toLowerCase() }));
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
          body: JSON.stringify({
            title: draft.title,
            ...(draft.slug ? { slug: draft.slug } : {}),
            bodyHtml: draft.bodyHtml,
            published: draft.published,
            ...(page ? { expectedUpdatedAt: page.updatedAt } : {}),
          }),
        },
      );
      const payload = await response.json().catch(() => null) as {
        error?: { code?: string; message?: string; data?: { fieldErrors?: Record<string, string> } };
      } | null;
      if (response.status === 409 || payload?.error?.code === "STALE_WRITE") {
        // Not an error the organizer caused, and not one they can fix by saving
        // again: somebody else's edit landed first, so say so and let the list
        // refetch rather than silently overwriting it.
        toast("This page changed since you opened it. Reloading the latest version — please re-apply your edit.");
        onSaved();
        return;
      }
      if (!response.ok) {
        setFieldErrors(payload?.error?.data?.fieldErrors ?? {});
        toast(payload?.error?.message ?? "That page could not be saved");
        return;
      }
      toast(draft.id ? "Page updated" : "Page created");
      onSaved();
    } catch {
      toast("That page could not be saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={draft.id ? "Edit resource page" : "New resource page"}
      description="Speakers see this in the portal once it is published."
      wide
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={!draft.title.trim() || saving} onClick={save}>{draft.id ? "Save changes" : "Create page"}</Button>
      </>}
    >
      <div className="form-stack">
        <Field label="Title" required {...hintProp(fieldErrors.title)}>
          <input autoFocus value={draft.title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Speaker Guide" />
        </Field>

        <Field label="URL" {...hintProp(fieldErrors.slug ?? `…/resources/${draft.slug || "…"}`)}>
          <input value={draft.slug} onChange={(event) => setSlug(event.target.value)} placeholder="speaker-guide" />
        </Field>

        <Field label="Body" group>
          <div className="rich-text-mode-toggle" role="tablist" aria-label="Body editing mode">
            <button type="button" role="tab" aria-selected={mode === "rich"} className={mode === "rich" ? "active" : ""} onClick={() => setMode("rich")}>Rich text</button>
            <button type="button" role="tab" aria-selected={mode === "source"} className={mode === "source" ? "active" : ""} onClick={() => setMode("source")}>HTML source</button>
          </div>
          {mode === "rich"
            ? <RichTextEditor value={draft.bodyHtml} onChange={(html) => setDraft((current) => ({ ...current, bodyHtml: html }))} placeholder="Write the page…" />
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
          <p className="field-note">
            HTML source is the only place to paste a video or map embed — the rich text toolbar never offers one.
            Both are sanitized on save and again on render: script tags and event handlers are always stripped, and
            an iframe survives only with an https:// source from an allowlisted host (YouTube, Vimeo, Loom, Google Docs).
          </p>
        </Field>

        <label className="inline-setting">
          <div><b>Published</b><small>Unpublished pages are invisible in the portal — organizers only.</small></div>
          <button
            type="button"
            className={`switch ${draft.published ? "on" : ""}`}
            role="switch"
            aria-checked={draft.published}
            aria-label="Published"
            onClick={() => setDraft((current) => ({ ...current, published: !current.published }))}
          ><i /></button>
        </label>

        {draft.id && draft.slug && (
          <a className="resource-editor-preview-link" href={`/portal/${eventSlug}/resources/${draft.slug}`} target="_blank" rel="noreferrer">
            View in portal ↗
          </a>
        )}
      </div>
    </Modal>
  );
}
