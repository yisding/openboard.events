"use client";

import { useState } from "react";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { Donut } from "@/shared/ui/app/donut";
import { FileUpload } from "@/shared/ui/app/file-upload";
import { StatTile } from "@/shared/ui/app/stat-tile";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { PageHeader } from "@/shared/ui/ui-kit";

const TIMEZONE = "America/Los_Angeles";
const DEMO_EVENT_ID = "11111111-1111-4111-8111-111111111111";

// The standing XSS probe, rendered through the one sanitizing view.
const HOSTILE_HTML = '<p>Bio with <b>bold</b>, a <a href="https://example.com">link</a>, '
  + 'and a probe: <img src=x onerror=alert(1)></p><script>alert(2)</script>';

export function RichPrimitives() {
  const [deadline, setDeadline] = useState<string | null>("2026-10-12T16:00:00.000Z");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [bio, setBio] = useState("<p>Paste a <script>alert(1)</script> here and watch it not survive.</p>");

  return (
    <main className="page">
      <PageHeader
        eyebrow="PLATFORM"
        title="Rich primitives"
        description="The editing and display primitives every feature shares. FileUpload here talks to the real presign and finalize endpoints."
      />

      <section style={{ marginBottom: 28 }}>
        <h2 className="section-title">RichTextView — the only sanitizing render site</h2>
        <p>The probe below contains an <code>onerror</code> handler and a <code>&lt;script&gt;</code>; neither survives.</p>
        <RichTextView html={HOSTILE_HTML} />
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 className="section-title">RichTextEditor — the toolbar is the allowlist</h2>
        <p>
          Every control here survives a save. Formatting the sanitizer would strip is not offered,
          and the counter uses the same <code>plainTextLength</code> the server rejects with.
        </p>
        <div style={{ maxWidth: 620 }}>
          <RichTextEditor value={bio} onChange={setBio} maxChars={5000} placeholder="Write a speaker bio…" />
        </div>
        <details style={{ marginTop: 10 }}>
          <summary className="section-title">Emitted HTML</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11.5 }}>{bio}</pre>
        </details>
      </section>

      <section style={{ marginBottom: 28 }}>
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

      <section style={{ marginBottom: 28 }}>
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

      <section style={{ marginBottom: 28 }}>
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
            { label: "Confirmed", value: 18, color: "#00a878" },
            { label: "Pending", value: 7, color: "#d98324" },
            { label: "Declined", value: 2, color: "#c04b4b" },
          ]} />
          {/* The empty event hits this on first paint. */}
          <Donut segments={[{ label: "Confirmed", value: 0, color: "#00a878" }]} />
        </div>
      </section>
    </main>
  );
}
