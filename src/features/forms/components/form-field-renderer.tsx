"use client";

import type { AnswerValue, FieldId, FormField, FormFieldRendererProps } from "@/shared/contracts";
import { evaluateVisibility } from "@/shared/lib/conditions";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { Dash } from "@/shared/ui/app/dash";
import { cn } from "@/shared/lib/cn";

/**
 * The one renderer for a form snapshot, behind the frozen `FormFieldRendererProps`.
 * The public CFP wizard, the portal's form tasks, the review panel and the
 * speaker's edit page all mount this — there is no `'fill'` mode, and a second
 * renderer would mean a question that behaves differently depending on where a
 * speaker happens to answer it.
 *
 * Visibility is evaluated here from the answers, so a conditional field appears
 * and disappears as somebody types without any caller wiring that up. The submit
 * pipeline strips hidden answers again server-side; this is the same rule shown
 * live, not the enforcement of it.
 */
export function FormFieldRenderer({
  snapshot,
  answers,
  onChange,
  mode,
  sectionKeys,
  participantId,
  errors,
}: FormFieldRendererProps) {
  const visible = evaluateVisibility(snapshot, answers);
  const sections = sectionKeys
    ? snapshot.sections.filter((section) => sectionKeys.includes(section.key))
    : snapshot.sections;

  return (
    <div className="form-render">
      {sections.map((section) => (
        <section key={section.id} className="form-render__section">
          {mode === "edit" && section.descriptionHtml && <RichTextView html={section.descriptionHtml} />}
          <div className="form-grid">
            {section.fields
              .filter((field) => visible.has(field.id))
              .map((field) => (
                <Field
                  key={field.id}
                  field={field}
                  value={answers[field.id]}
                  mode={mode}
                  {...(errors?.[field.id] ? { error: errors[field.id] } : {})}
                  onChange={(next) => onChange(field.id, next)}
                  participantId={participantId ?? null}
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Field({
  field,
  value,
  mode,
  error,
  onChange,
  participantId,
}: {
  field: FormField;
  value: AnswerValue | undefined;
  mode: FormFieldRendererProps["mode"];
  error?: string;
  onChange: (value: AnswerValue | undefined) => void;
  participantId: string | null;
}) {
  // One id per (field, participant) so the participant section can repeat
  // without two inputs claiming the same label.
  const id = participantId ? `${field.id}:${participantId}` : field.id;
  const readOnly = mode !== "edit";

  return (
    <label className={cn("field", error && "field--error", field.type === "richtext" && "field--wide")} htmlFor={id}>
      <span>
        {field.label}
        {field.required && mode === "edit" && <em aria-hidden="true"> *</em>}
      </span>
      {readOnly ? <ReadOnlyValue field={field} value={value} /> : <Input field={field} id={id} value={value} onChange={onChange} />}
      {field.helpText && mode === "edit" && <small>{field.helpText}</small>}
      {error && <strong role="alert">{error}</strong>}
    </label>
  );
}

/** What a reviewer or a read-only speaker sees: the answer, never an input. */
function ReadOnlyValue({ field, value }: { field: FormField; value: AnswerValue | undefined }) {
  if (!value) return <Dash />;
  if (field.type === "richtext" && value.t === "s") return <RichTextView html={value.v} />;
  if (value.t === "opt") return <span>{field.options.find((option) => option.id === value.v)?.label ?? value.v}</span>;
  if (value.t === "opts") {
    const labels = value.v.map((chosen) => field.options.find((option) => option.id === chosen)?.label ?? chosen);
    return <span>{labels.join(", ")}</span>;
  }
  if (value.t === "file") return <a href={`/f/${value.v}`} target="_blank" rel="noreferrer">Uploaded file</a>;
  return <span>{String(value.v)}</span>;
}

function Input({
  field,
  id,
  value,
  onChange,
}: {
  field: FormField;
  id: string;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue | undefined) => void;
}) {
  const text = value?.t === "s" ? value.v : "";
  const emit = (next: string) => onChange(next === "" ? undefined : { t: "s", v: next });

  switch (field.type) {
    case "richtext":
      return (
        <RichTextEditor
          value={text}
          onChange={(html) => onChange(html === "" ? undefined : { t: "s", v: html })}
          {...(field.maxChars ? { maxChars: field.maxChars } : {})}
        />
      );
    case "textarea":
      return <textarea id={id} value={text} rows={5} maxLength={field.maxChars ?? undefined} onChange={(event) => emit(event.target.value)} />;
    case "dropdown":
    case "radio":
      return (
        <select id={id} value={value?.t === "opt" ? value.v : ""} onChange={(event) => onChange(event.target.value ? { t: "opt", v: event.target.value } : undefined)}>
          <option value="">Choose one</option>
          {field.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      );
    case "multiselect":
    case "checkbox": {
      const chosen = value?.t === "opts" ? value.v : [];
      return (
        <div className="choice-list" role="group" aria-labelledby={id}>
          {field.options.map((option) => (
            <label key={option.id} className="choice">
              <input
                type="checkbox"
                checked={chosen.includes(option.id)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...chosen, option.id]
                    : chosen.filter((existing) => existing !== option.id);
                  onChange(next.length > 0 ? { t: "opts", v: next } : undefined);
                }}
              />
              {option.label}
            </label>
          ))}
        </div>
      );
    }
    case "number":
      return <input id={id} type="number" value={value?.t === "n" ? value.v : ""} onChange={(event) => onChange(event.target.value === "" ? undefined : { t: "n", v: Number(event.target.value) })} />;
    case "date":
      return <input id={id} type="date" value={value?.t === "d" ? value.v : ""} onChange={(event) => onChange(event.target.value ? { t: "d", v: event.target.value } : undefined)} />;
    case "file":
      // Uploads mint a fileId through M07's presign/finalize; until this form is
      // wired to <FileUpload> the value is set by the caller, never typed.
      return value?.t === "file"
        ? <a href={`/f/${value.v}`} target="_blank" rel="noreferrer">Uploaded file</a>
        : <span className="dash">No file yet</span>;
    case "email":
      return <input id={id} type="email" value={text} maxLength={field.maxChars ?? undefined} onChange={(event) => emit(event.target.value)} />;
    case "url":
      return <input id={id} type="url" value={text} maxLength={field.maxChars ?? undefined} onChange={(event) => emit(event.target.value)} />;
    case "phone":
      return <input id={id} type="tel" value={text} maxLength={field.maxChars ?? undefined} onChange={(event) => emit(event.target.value)} />;
    case "text":
      return <input id={id} type="text" value={text} maxLength={field.maxChars ?? undefined} onChange={(event) => emit(event.target.value)} />;
  }
}

export type { FieldId };
