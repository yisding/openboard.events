"use client";

import { useState } from "react";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { Donut } from "@/shared/ui/app/donut";
import { FileUpload } from "@/shared/ui/app/file-upload";
import { StatTile } from "@/shared/ui/app/stat-tile";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { Field, PageHeader, Select } from "@/shared/ui/ui-kit";

const TIMEZONE = "America/Los_Angeles";
const DEMO_EVENT_ID = "11111111-1111-4111-8111-111111111111";

// The standing XSS probe, rendered through the one sanitizing view.
const HOSTILE_HTML = '<p>Bio with <b>bold</b>, a <a href="https://example.com">link</a>, '
  + 'and a probe: <img src=x onerror=alert(1)></p><script>alert(2)</script>';

export function RichPrimitives() {
  const [deadline, setDeadline] = useState<string | null>("2026-10-12T16:00:00.000Z");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [track, setTrack] = useState("ai-agents");
  const [bio, setBio] = useState("<p>Paste a <script>alert(1)</script> here and watch it not survive.</p>");

  return (
    <main className="page">
      <PageHeader
        eyebrow="PLATFORM"
        title="Rich primitives"
        description="The editing and display primitives every feature shares. FileUpload here talks to the real presign and finalize endpoints."
      />

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">RichTextView — the only sanitizing render site</h2>
        <p>The probe below contains an <code>onerror</code> handler and a <code>&lt;script&gt;</code>; neither survives.</p>
        <RichTextView html={HOSTILE_HTML} />
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">RichTextEditor — the toolbar is the allowlist</h2>
        <p>
          Every control here survives a save. Formatting the sanitizer would strip is not offered,
          and the counter uses the same <code>plainTextLength</code> the server rejects with.
        </p>
        <div style={{ maxWidth: 620 }}>
          <RichTextEditor value={bio} onChange={setBio} maxChars={5000} placeholder="Write a speaker bio…" />
        </div>
        <details style={{ marginTop: 12 }}>
          <summary className="section-title">Emitted HTML</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11.5 }}>{bio}</pre>
        </details>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">DateTimePicker — event timezone, always labelled</h2>
        <div style={{ display: "grid", gap: 12, maxWidth: 460 }}>
          <label className="field">
            <span>Submission deadline (datetime)</span>
            <DateTimePicker value={deadline} onChange={setDeadline} tz={TIMEZONE} />
            <small>Emits {deadline ?? "null"}</small>
          </label>
          <label className="field">
            <span>Task due date (date — end of day in event tz)</span>
            <DateTimePicker value={dueDate} onChange={setDueDate} tz={TIMEZONE} mode="date" />
            <small>Emits {dueDate ?? "null"}</small>
          </label>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">Select — the kit&apos;s chevron, not the OS arrow</h2>
        <p>
          A native <code>&lt;select&gt;</code> underneath, so keyboard type-ahead, <kbd>Esc</kbd> and the
          platform picker on touch all still work. What changes is the chrome: no OS arrow, and the same
          border, focus ring and disabled treatment as every other control. Compare the four states below —
          they should differ from each other and from nothing else on the page.
        </p>
        <div style={{ display: "grid", gap: 12, maxWidth: 460 }}>
          <Field label="Track">
            <Select value={track} onChange={(event) => setTrack(event.target.value)}>
              <option value="ai-agents">AI Agents</option>
              <option value="infrastructure">Infrastructure</option>
              <option value="safety">Safety</option>
            </Select>
          </Field>
          <Field label="Room" hint="Disabled — the kit's disabled treatment, not the OS one">
            <Select disabled value="main-stage">
              <option value="main-stage">Main Stage</option>
            </Select>
          </Field>
          <Field label="Format" error="Pick a format before saving" errorId="kitchen-sink-format-error">
            <Select aria-describedby="kitchen-sink-format-error" defaultValue="">
              <option value="">Select a format…</option>
              <option value="keynote">Keynote · 45 min</option>
            </Select>
          </Field>
          <Field label="Track scope" hint="multiple — an always-open listbox keeps native rendering, with no chevron">
            <Select multiple size={3} defaultValue={[]}>
              <option value="ai-agents">AI Agents</option>
              <option value="infrastructure">Infrastructure</option>
              <option value="safety">Safety</option>
            </Select>
          </Field>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">FileUpload — presign, PUT to R2, finalize</h2>
        <p>
          Needs a signed-in session and a real event id; against the demo id below it should fail at
          presign with the server&apos;s own message, which is exactly what the error state is for.
        </p>
        <div style={{ maxWidth: 420 }}>
          <FileUpload
            eventId={DEMO_EVENT_ID}
            kind="headshot"
            label="Upload a headshot"
            onUploaded={(fileId) => setUploaded(fileId)}
          />
        </div>
        {uploaded && <p>Uploaded as <code>{uploaded}</code> — served from <code>/f/{uploaded}</code>.</p>}
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">StatTile</h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <StatTile label="Submissions" value={128} hint="+12 today" href="/events/demo/abstracts" />
          <StatTile label="Awaiting review" value={9} tone="warning" />
          <StatTile label="Overdue tasks" value={3} tone="danger" />
          <StatTile label="Never counted" value={null} hint="renders a dash, not a zero" />
          <StatTile label="Loading" value={0} isLoading />
        </div>
      </section>

      <section>
        <h2 className="section-title">Donut</h2>
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
          <Donut segments={[
            { label: "Confirmed", value: 18, color: "var(--accent)" },
            { label: "Pending", value: 7, color: "var(--amber)" },
            { label: "Declined", value: 2, color: "var(--red)" },
          ]} />
          {/* The empty event hits this on first paint. */}
          <Donut segments={[{ label: "Confirmed", value: 0, color: "var(--accent)" }]} />
        </div>
      </section>
    </main>
  );
}
