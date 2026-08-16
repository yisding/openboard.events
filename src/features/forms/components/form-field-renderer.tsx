"use client";

import React from "react";
import { fileIdSchema, plainTextLength, type AnswerValue, type FieldId, type FormField, type FormFieldRendererProps } from "@/shared/contracts";
import { evaluateVisibility } from "@/shared/lib/conditions";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { Dash } from "@/shared/ui/app/dash";
import { CalendarDatePicker } from "@/shared/ui/app/datetime-picker";
import { cn } from "@/shared/lib/cn";
import { FileUpload } from "@/shared/ui/app/file-upload";
import { useFormUploadEventId } from "@/shared/ui/app/form-upload-context";
import { PrivateFileLink } from "@/shared/ui/app/private-file-link";
import { Select } from "@/shared/ui/ui-kit";

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
  visibilityAnswers,
  errors,
}: FormFieldRendererProps) {
  const visible = evaluateVisibility(snapshot, visibilityAnswers ? { ...visibilityAnswers, ...answers } : answers);
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
              .filter((field) => visible.has(field.id) && isRenderableFormField(field))
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

/**
 * An optional choice question with no choices is configuration, not a
 * question a speaker can answer. Keep it in the authoring model so an
 * organizer can add options later, but leave it out of every shared runtime
 * rendering (public CFP, portal task, review, and builder preview) until it is
 * useful. A required empty choice remains visible so a broken form cannot
 * silently appear complete or let a speaker skip a question the snapshot
 * says they must answer.
 */
export function isRenderableFormField(field: FormField): boolean {
  return !["dropdown", "radio", "multiselect", "checkbox"].includes(field.type)
    || field.required
    || field.options.length > 0;
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
  const labelId = `${id}-label`;
  const helpId = field.helpText && mode === "edit" ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
  const composite = readOnly || ["richtext", "multiselect", "checkbox", "file"].includes(field.type);

  const content = <>
    <span id={labelId}>
      {field.label}
      {field.required && mode === "edit" && <em aria-hidden="true"> *</em>}
    </span>
    {readOnly ? <ReadOnlyValue field={field} value={value} /> : <Input field={field} id={id} labelId={labelId} {...(describedBy ? { describedBy } : {})} invalid={Boolean(error)} value={value} onChange={onChange} />}
    {helpId && <small id={helpId}>{field.helpText}</small>}
    {errorId && <strong id={errorId} role="alert">{error}</strong>}
  </>;

  const className = cn("field", error && "field--error", field.type === "richtext" && "field--wide");
  return composite ? <div className={className}>{content}</div> : <label className={className} htmlFor={id}>{content}</label>;
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
  if (value.t === "file") return <PrivateFileLink fileId={value.v} />;
  return <span>{String(value.v)}</span>;
}

function Input({
  field,
  id,
  labelId,
  describedBy,
  invalid,
  value,
  onChange,
}: {
  field: FormField;
  id: string;
  labelId: string;
  describedBy?: string;
  invalid: boolean;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue | undefined) => void;
}) {
  const uploadEventId = useFormUploadEventId();
  const text = value?.t === "s" ? value.v : "";
  // An emptied field emits an explicit empty answer, not `undefined`.
  // `JSON.stringify` drops an undefined value's key entirely, so the server
  // could not tell "the speaker cleared this" from "the speaker never touched
  // it": the key vanished from `form_responses.answers` too, and the prefill
  // overlay fell straight back to the stale column. Clearing Company in a
  // portal task and reopening it showed "Acme" again, and the public gallery
  // still said Acme. `isEmpty` still treats this as empty, so a required field
  // is refused exactly as before.
  const emit = (next: string) => onChange({ t: "s", v: next });
  const controlProps = {
    required: field.required || undefined,
    "aria-invalid": invalid || undefined,
    "aria-describedby": describedBy,
  };

  switch (field.type) {
    case "richtext":
      return (
        <RichTextEditor
          value={text}
          onChange={(html) => onChange(toRichTextAnswer(html))}
          ariaLabelledBy={labelId}
          {...(describedBy ? { ariaDescribedBy: describedBy } : {})}
          ariaInvalid={invalid}
          required={field.required}
          {...(field.maxChars ? { maxChars: field.maxChars } : {})}
        />
      );
    case "textarea":
      return <textarea id={id} {...controlProps} value={text} rows={5} maxLength={field.maxChars ?? undefined} onChange={(event) => emit(event.target.value)} />;
    case "dropdown":
    case "radio":
      return (
        <Select id={id} {...controlProps} value={value?.t === "opt" ? value.v : ""} onChange={(event) => onChange(event.target.value ? { t: "opt", v: event.target.value } : undefined)}>
          <option value="">Choose one</option>
          {field.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </Select>
      );
    case "multiselect":
    case "checkbox": {
      const chosen = value?.t === "opts" ? value.v : [];
      return (
        <fieldset className="choice-list field-control-group" aria-describedby={describedBy} aria-invalid={invalid || undefined} tabIndex={invalid ? -1 : undefined}>
          <legend className="sr-only">{field.label}{field.required ? " (required)" : ""}</legend>
          {field.options.map((option) => (
            <label key={option.id} className="choice">
              <input
                type="checkbox"
                aria-invalid={invalid || undefined}
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
        </fieldset>
      );
    }
    case "number":
      return <input id={id} {...controlProps} type="number" value={value?.t === "n" ? value.v : ""} onChange={(event) => onChange(event.target.value === "" ? undefined : { t: "n", v: Number(event.target.value) })} />;
    case "date":
      return <CalendarDatePicker
        id={id}
        required={field.required}
        invalid={invalid}
        {...(describedBy ? { ariaDescribedBy: describedBy } : {})}
        value={value?.t === "d" ? value.v : null}
        onChange={(next) => onChange(next ? { t: "d", v: next } : undefined)}
      />;
    case "file":
      return uploadEventId ? (
        <fieldset className="field-control-group" aria-describedby={describedBy} aria-invalid={invalid || undefined} tabIndex={invalid ? -1 : undefined}>
        <legend className="sr-only">{field.label}{field.required ? " (required)" : ""}</legend>
        <FileUpload
          eventId={uploadEventId}
          kind="attachment"
          currentFileId={value?.t === "file" ? value.v : null}
          onUploaded={(fileId) => onChange({ t: "file", v: fileIdSchema.parse(fileId) })}
        />
        </fieldset>
      ) : (
        <span className="dash">File uploads are unavailable here</span>
      );
    case "email":
      return <input id={id} {...controlProps} type="email" value={text} maxLength={field.maxChars ?? undefined} onChange={(event) => emit(event.target.value)} />;
    case "url":
      return <input id={id} {...controlProps} type="url" value={text} maxLength={field.maxChars ?? undefined} onChange={(event) => emit(event.target.value)} />;
    case "phone":
      return <input id={id} {...controlProps} type="tel" value={text} maxLength={field.maxChars ?? undefined} onChange={(event) => emit(event.target.value)} />;
    case "text":
      return <input id={id} {...controlProps} type="text" value={text} maxLength={field.maxChars ?? undefined} onChange={(event) => emit(event.target.value)} />;
  }
}

export function toRichTextAnswer(html: string): AnswerValue {
  // Same reason as `emit` above: an emptied editor has to reach the server as a
  // clear rather than as an absent key. The empty string, not the editor's
  // leftover `<p></p>`, so nothing downstream mistakes markup for content.
  return plainTextLength(html) === 0 ? { t: "s", v: "" } : { t: "s", v: html };
}

export type { FieldId };
