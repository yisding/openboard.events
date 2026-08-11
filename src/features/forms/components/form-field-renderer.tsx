"use client";

import React from "react";
import { fileIdSchema, plainTextLength, type AnswerValue, type FieldId, type FormField, type FormFieldRendererProps } from "@/shared/contracts";
import { evaluateVisibility } from "@/shared/lib/conditions";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { Dash } from "@/shared/ui/app/dash";
import { cn } from "@/shared/lib/cn";
import { FileUpload } from "@/shared/ui/app/file-upload";
import { useFormUploadEventId } from "@/shared/ui/app/form-upload-context";
import { PrivateFileLink } from "@/shared/ui/app/private-file-link";

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
  const emit = (next: string) => onChange(next === "" ? undefined : { t: "s", v: next });
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
        <select id={id} {...controlProps} value={value?.t === "opt" ? value.v : ""} onChange={(event) => onChange(event.target.value ? { t: "opt", v: event.target.value } : undefined)}>
          <option value="">Choose one</option>
          {field.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      );
    case "multiselect":
    case "checkbox": {
      const chosen = value?.t === "opts" ? value.v : [];
      return (
        <fieldset className="choice-list field-control-group" aria-describedby={describedBy}>
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
      return <input id={id} {...controlProps} type="date" value={value?.t === "d" ? value.v : ""} onChange={(event) => onChange(event.target.value ? { t: "d", v: event.target.value } : undefined)} />;
    case "file":
      return uploadEventId ? (
        <fieldset className="field-control-group" aria-describedby={describedBy}>
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

export function toRichTextAnswer(html: string): AnswerValue | undefined {
  return plainTextLength(html) === 0 ? undefined : { t: "s", v: html };
}

export type { FieldId };
