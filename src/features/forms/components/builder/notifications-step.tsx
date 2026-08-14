"use client";

import { useState } from "react";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { Button, Field, Switch } from "@/shared/ui/ui-kit";
import type { BuilderForm, FormPatch } from "../../builder-types";

const captionStyle = { color: "var(--muted)", fontSize: "var(--text-xs)", margin: "-12px 0 16px" } as const;
const fallbackNote = { color: "var(--muted)", fontSize: "var(--text-xs)", lineHeight: 1.5, margin: "6px 0 16px" } as const;

/**
 * "Notifications" — the Submission Confirmation email.
 *
 * Both `NULL`/blank subject and body fall back to the event-level
 * `submission_received` template (stated in the UI, not just implied): the
 * dispatcher (`comms/server/context.ts#buildContext`) only builds a
 * `templateOverride` when one of the two is non-empty. Unknown `{{token}}`s
 * are rejected at save time, server-side (`saveNotificationsStep` /
 * `assertValidConfirmationTemplate`) — this component surfaces whatever
 * message that throw carries via the builder's existing toast-on-error path,
 * never a send-time failure.
 *
 * No "Admin alert recipients" section (cut from the draft for schedule
 * relief, PLAN §4/M14).
 */
export function NotificationsStep({ form, onChange }: {
  form: BuilderForm;
  onChange: (patch: FormPatch) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <section className="builder-step">
      <header>
        <div className="step-number">6</div>
        <div>
          <h2>Notifications</h2>
          <p>Customize the automated email for this form.</p>
        </div>
      </header>
      <div className="builder-card">
        <h3>Submitter notifications</h3>
        <p style={captionStyle}>1 template</p>
        <div className="inline-setting">
          <div>
            <b>Submission Confirmation</b>
            <small>Email sent to the submitter after a successful submission</small>
          </div>
          <Switch
            label="Send submission confirmation"
            checked={form.sendConfirmation}
            onClick={() => onChange({ sendConfirmation: !form.sendConfirmation })}
          />
        </div>
        <Button
          variant="secondary"
          style={{ marginTop: 16 }}
          onClick={() => setExpanded((current) => !current)}
        >{expanded ? "Hide customization" : "Customize"}</Button>
        {expanded && (
          <div className="form-stack" style={{ marginTop: 16 }}>
            <p style={fallbackNote}>Leave blank to use the event&rsquo;s default template.</p>
            <Field label="Subject">
              <input
                maxLength={255}
                value={form.confirmationSubject}
                onChange={(current) => onChange({ confirmationSubject: current.target.value })}
                placeholder="We received your submission"
              />
            </Field>
            <Field label="Body">
              <RichTextEditor ariaLabel="Confirmation email body" value={form.confirmationBodyHtml} onChange={(confirmationBodyHtml) => onChange({ confirmationBodyHtml })} maxChars={5000} />
            </Field>
          </div>
        )}
      </div>
    </section>
  );
}
