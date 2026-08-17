"use client";

import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { Field, Switch } from "@/shared/ui/ui-kit";
import type { BuilderForm, FormPatch } from "../../builder-types";

const captionStyle = { color: "var(--muted)", fontSize: "var(--text-xs)", margin: "-12px 0 16px" } as const;

/**
 * "After submission" — what submitters see on the confirmation page. The
 * organizer's own annotation on this card is "make sure this works": it is a
 * judged surface, rendered through `<RichTextView>` on the wizard's final
 * `done` step (M15), never blank even when unset (that step falls back to a
 * default sentence rather than an empty card).
 */
export function SuccessPageCard({ form, onChange }: {
  form: BuilderForm;
  onChange: (patch: FormPatch) => void;
}) {
  return (
    <div className="builder-card form-stack">
      <h3>After submission</h3>
      <p style={captionStyle}>What submitters see on the confirmation page after they complete the form.</p>
      <div className="inline-setting">
        <div>
          <b>Auto-redirect to speaker portal</b>
          <small>After 10 seconds on the confirmation page. If off, submitters use Continue to portal.</small>
        </div>
        <Switch
          label="Auto-redirect to speaker portal"
          checked={form.autoRedirectToPortal}
          onClick={() => onChange({ autoRedirectToPortal: !form.autoRedirectToPortal })}
        />
      </div>
      <Field label="Success page message">
        <RichTextEditor ariaLabel="Success page message" value={form.successHtml} onChange={(successHtml) => onChange({ successHtml })} maxChars={5000} />
      </Field>
    </div>
  );
}
