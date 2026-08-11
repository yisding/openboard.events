"use client";

import { Field } from "@/shared/ui/ui-kit";
import type { BuilderEvent, BuilderForm, FormPatch } from "../../builder-types";
import { CloseDateCard } from "./close-date-card";
import { SuccessPageCard } from "./success-page-card";

const captionStyle = { color: "var(--muted)", fontSize: 11.5, margin: "-10px 0 16px" } as const;
const helpStyle = { color: "var(--muted)", fontSize: 11, lineHeight: 1.5, margin: "10px 0 0" } as const;

/**
 * "Settings" step — Deadlines, Submission capacity, After submission.
 *
 * Server-backed: every field here round-trips through `saveSettingsStep`
 * (`server/settings-mutations.ts`), which persists to `forms` and recompiles
 * the immutable snapshot. The only authority for whether the form is actually
 * accepting submissions is the SQL `is_form_open()` predicate evaluated inside
 * the submit transaction — this step (and `formOpenState`, `lib/form-open.ts`)
 * is advisory display, never the gate itself.
 */
export function SettingsStep({ event, form, onChange }: {
  event: BuilderEvent;
  form: BuilderForm;
  onChange: (patch: FormPatch) => void;
}) {
  const hasLimit = form.submissionLimit !== null;
  return (
    <section className="builder-step">
      <header>
        <div className="step-number">5</div>
        <div>
          <h2>Form settings</h2>
          <p>Control availability, limits, and the completion experience.</p>
        </div>
      </header>
      <CloseDateCard event={event} form={form} onChange={onChange} />
      <div className="builder-card form-stack">
        <h3>Submission capacity</h3>
        <p style={captionStyle}>How many sessions each submitter may have for this form.</p>
        <div className="inline-setting">
          <div>
            <b>Set Submission Limit</b>
            <small>Overrides the event&apos;s per-user default for this form only.</small>
          </div>
          <button
            type="button"
            className={`switch ${hasLimit ? "on" : ""}`}
            onClick={() => onChange({ submissionLimit: hasLimit ? null : 1 })}
          ><i /></button>
        </div>
        {hasLimit && (
          <Field label="Submission limit">
            <input
              type="number"
              min={1}
              max={50}
              value={form.submissionLimit ?? ""}
              onChange={(current) => {
                const parsed = Number(current.target.value);
                onChange({ submissionLimit: current.target.value && Number.isFinite(parsed) ? Math.min(50, Math.max(1, Math.trunc(parsed))) : null });
              }}
            />
          </Field>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <span className="chip" title="Applies when no form-level limit is set.">
            Event max: {event.submissionCapPerUser}
          </span>
        </div>
        <p style={helpStyle}>Counts submitted sessions only — saved drafts don&apos;t use up the limit.</p>
      </div>
      <SuccessPageCard form={form} onChange={onChange} />
    </section>
  );
}
