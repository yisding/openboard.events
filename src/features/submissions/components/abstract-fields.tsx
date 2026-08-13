"use client";

import type { SubmissionVocabulary } from "@/features/submissions";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { Field, Select } from "@/shared/ui/ui-kit";

/**
 * The abstract's typed columns, in the order the screenshot puts them. Add and
 * edit are the same eleven fields, so they are the same component — two copies
 * would have drifted the first time somebody added a column to one of them.
 *
 * Everything is a string in here and converted at the edge (`toPatch` /
 * `toCreateBody`), because a half-typed capacity is `"1"` before it is `1` and a
 * form that reformats what you are typing is a form nobody can type into.
 */
export type AbstractFieldValues = {
  title: string;
  descriptionHtml: string;
  trackId: string;
  formatId: string;
  level: string;
  language: string;
  capacity: string;
  clientSessionId: string;
  startsAt: string | null;
  endsAt: string | null;
  tagIds: string[];
};

export const EMPTY_ABSTRACT_FIELDS: AbstractFieldValues = {
  title: "",
  descriptionHtml: "",
  trackId: "",
  formatId: "",
  level: "",
  language: "",
  capacity: "",
  clientSessionId: "",
  startsAt: null,
  endsAt: null,
  tagIds: [],
};

/** `""` is the "no choice" option in a `<Select>` dropdown; the column wants `null`. */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toCreateBody(values: AbstractFieldValues, status: string): Record<string, unknown> {
  return {
    status,
    title: values.title.trim(),
    descriptionHtml: orNull(values.descriptionHtml),
    trackId: orNull(values.trackId),
    formatId: orNull(values.formatId),
    level: orNull(values.level),
    language: orNull(values.language),
    capacity: values.capacity.trim() === "" ? null : Number(values.capacity),
    startsAt: values.startsAt,
    endsAt: values.endsAt,
    clientSessionId: orNull(values.clientSessionId),
    tagIds: values.tagIds,
  };
}

/**
 * Only what actually changed. A patch that resent every field would let a drawer
 * opened before a colleague's edit blank their work on save, even for fields the
 * organizer never touched.
 */
export function toPatch(values: AbstractFieldValues, original: AbstractFieldValues): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (values.title !== original.title) patch.title = values.title.trim();
  if (values.descriptionHtml !== original.descriptionHtml) patch.descriptionHtml = orNull(values.descriptionHtml);
  if (values.trackId !== original.trackId) patch.trackId = orNull(values.trackId);
  if (values.formatId !== original.formatId) patch.formatId = orNull(values.formatId);
  if (values.level !== original.level) patch.level = orNull(values.level);
  if (values.language !== original.language) patch.language = orNull(values.language);
  if (values.capacity !== original.capacity) {
    patch.capacity = values.capacity.trim() === "" ? null : Number(values.capacity);
  }
  if (values.clientSessionId !== original.clientSessionId) patch.clientSessionId = orNull(values.clientSessionId);
  if (values.startsAt !== original.startsAt) patch.startsAt = values.startsAt;
  if (values.endsAt !== original.endsAt) patch.endsAt = values.endsAt;
  if (values.tagIds.join(",") !== original.tagIds.join(",")) patch.tagIds = values.tagIds;
  return patch;
}

export function AbstractFields({
  values,
  onChange,
  vocabulary,
  timezone,
  disabled = false,
}: {
  values: AbstractFieldValues;
  onChange: (next: AbstractFieldValues) => void;
  vocabulary: SubmissionVocabulary;
  timezone: string;
  disabled?: boolean;
}) {
  const set = <K extends keyof AbstractFieldValues>(key: K, value: AbstractFieldValues[K]) => {
    onChange({ ...values, [key]: value });
  };

  return (
    <div className="form-stack">
      <Field label="Session title" required hint={`${values.title.length}/255`}>
        <input
          value={values.title}
          maxLength={255}
          disabled={disabled}
          onChange={(event) => set("title", event.target.value)}
          placeholder="Enter a clear session title"
        />
      </Field>

      <Field label="Description">
        <RichTextEditor
          value={values.descriptionHtml}
          onChange={(next) => set("descriptionHtml", next)}
          ariaLabel="Session description"
          disabled={disabled}
        />
      </Field>

      <Field label="Track">
        <Select value={values.trackId} disabled={disabled} onChange={(event) => set("trackId", event.target.value)}>
          <option value="">No track</option>
          {vocabulary.tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
        </Select>
      </Field>

      <Field label="Format">
        <Select value={values.formatId} disabled={disabled} onChange={(event) => set("formatId", event.target.value)}>
          <option value="">No format</option>
          {vocabulary.formats.map((format) => <option key={format.id} value={format.id}>{format.name}</option>)}
        </Select>
      </Field>

      <Field label="Level">
        <input value={values.level} disabled={disabled} onChange={(event) => set("level", event.target.value)} placeholder="Beginner, Intermediate…" />
      </Field>

      <Field label="Language">
        <input value={values.language} disabled={disabled} onChange={(event) => set("language", event.target.value)} placeholder="English" />
      </Field>

      <Field label="Capacity">
        <input
          value={values.capacity}
          disabled={disabled}
          inputMode="numeric"
          onChange={(event) => set("capacity", event.target.value.replace(/[^0-9]/g, ""))}
          placeholder="Room capacity"
        />
      </Field>

      <Field label="Client session ID" hint="The id this session carries in your own systems.">
        <input value={values.clientSessionId} disabled={disabled} onChange={(event) => set("clientSessionId", event.target.value)} />
      </Field>

      {/* Both instants are entered and shown in the event's zone, with its label
          on screen — an organizer in another zone cannot set a start an hour off
          without seeing it. */}
      <Field label="Starts at">
        <DateTimePicker value={values.startsAt} onChange={(next) => set("startsAt", next)} tz={timezone} disabled={disabled} />
      </Field>

      <Field label="Ends at">
        <DateTimePicker value={values.endsAt} onChange={(next) => set("endsAt", next)} tz={timezone} disabled={disabled} />
      </Field>

      {vocabulary.tags.length > 0 && (
        <Field label="Tags" group>
          <div className="chip-picker">
            {vocabulary.tags.map((tag) => {
              const selected = values.tagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  className={selected ? "chip chip--selected" : "chip"}
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => set("tagIds", selected
                    ? values.tagIds.filter((id) => id !== tag.id)
                    : [...values.tagIds, tag.id])}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </Field>
      )}
    </div>
  );
}
