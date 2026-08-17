"use client";

import { Inbox, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { SUBMISSION_STATUSES } from "@/shared/contracts";
import { ColorChip } from "@/shared/ui/app/color-chip";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { DataTable, nullsLast } from "@/shared/ui/app/data-table";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { Dash } from "@/shared/ui/app/dash";
import { FirstRunHints, Hint, resetHints } from "@/shared/ui/app/first-run-hints";
import { moveRovingTab } from "@/shared/ui/app/roving-tabs";
import { TzTime } from "@/shared/ui/app/tz-time";
import { useToast } from "@/shared/ui/toast";
import { Avatar, Button, Drawer, EmptyState, Field, Modal, PageHeader, SearchInput, StatusBadge, Switch } from "@/shared/ui/ui-kit";
import { CommandPalette } from "./components/command-palette";

const TIMEZONE = "America/Los_Angeles";

type DemoRow = {
  id: string;
  code: string;
  title: string;
  track: { label: string } | null;
  rating: number | null;
  submittedAt: string;
};

/* No colours here on purpose. T6 carve-out 5 gives organiser-chosen track
   colour to the schedule and agenda grids only, and `ColorChip` says the same
   in its own docstring: everywhere else it renders the neutral `.track-chip`.
   This is a DataTable, so it takes the neutral path — and a showcase route
   that demonstrated the wrong one would teach the wrong rule. */
const TRACKS = [{ label: "Agents" }, { label: "Evals" }, { label: "Infra" }];

/* Own scope and ids, so acknowledging the demo never touches the admin
   shell's real first-run beacons (and vice versa). */
const HINT_IDS: readonly string[] = ["kitchen-sink:demo"];

type DemoTab = "overview" | "reviews" | "activity";
const DEMO_TABS: readonly DemoTab[] = ["overview", "reviews", "activity"];
const DEMO_TAB_LABEL: Record<DemoTab, string> = { overview: "Overview", reviews: "Reviews", activity: "Activity" };

type DemoStage = "all" | "open" | "overdue" | "done";
const DEMO_STAGES: ReadonlyArray<{ value: DemoStage; label: string; count: number }> = [
  { value: "all", label: "All", count: 25 },
  { value: "open", label: "Open", count: 11 },
  { value: "overdue", label: "Overdue", count: 3 },
  { value: "done", label: "Done", count: 11 },
];

const DEMO_TAGS = ["Agents", "Evals", "Infra", "Safety"];

// 25 rows, matching seed volume. Every third row has no rating and every fifth
// has no track, so the dash and the nulls-last comparator are both visible.
const ROWS: DemoRow[] = Array.from({ length: 25 }, (_, index) => ({
  id: `row-${index}`,
  code: `SESS-${101 + index}`,
  title: index === 7 ? "A title long enough to prove the cell wraps instead of stretching the table" : `Fixture submission ${index + 1}`,
  track: index % 5 === 0 ? null : TRACKS[index % 3] ?? null,
  rating: index % 3 === 0 ? null : Number((2 + (index % 4) * 0.7).toFixed(1)),
  submittedAt: new Date(Date.UTC(2026, 7, 1 + (index % 20), 16, 30)).toISOString(),
}));

export function KitchenSink() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [confirming, setConfirming] = useState<"destructive" | "stale" | null>(null);
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [plainModalOpen, setPlainModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sampleDate, setSampleDate] = useState<string | null>("2026-09-15T16:00:00.000Z");
  const [tab, setTab] = useState<DemoTab>("overview");
  const [stage, setStage] = useState<DemoStage>("all");
  const [tags, setTags] = useState<string[]>(["Agents"]);
  const [notify, setNotify] = useState(true);
  const [autoPublish, setAutoPublish] = useState(false);

  const data = useMemo(
    () => ROWS.filter((row) => `${row.code} ${row.title}`.toLowerCase().includes(search.toLowerCase())),
    [search],
  );

  const columns = useMemo<Array<ColumnDef<DemoRow, unknown>>>(() => [
    { id: "code", header: "Code", accessorKey: "code", cell: ({ row }) => <span className="submission-code">{row.original.code}</span> },
    { id: "title", header: "Title", accessorKey: "title", cell: ({ row }) => <div className="submission-title-cell"><b>{row.original.title}</b></div> },
    {
      id: "track",
      header: "Track",
      accessorFn: (row) => row.track?.label ?? null,
      sortingFn: nullsLast,
      cell: ({ row }) => row.original.track
        ? <ColorChip label={row.original.track.label} />
        : <Dash />,
    },
    {
      id: "rating",
      header: "Rating",
      accessorKey: "rating",
      sortingFn: nullsLast,
      cell: ({ row }) => <Dash value={row.original.rating}><span className="rating">{row.original.rating}</span></Dash>,
    },
    {
      id: "submitted",
      header: "Submitted",
      accessorKey: "submittedAt",
      cell: ({ row }) => <TzTime instant={row.original.submittedAt} tz={TIMEZONE} style="date" secondary="time" />,
    },
  ], []);

  return (
    <main className="page showcase-page">
      <PageHeader
        eyebrow="PLATFORM"
        title="Kitchen sink"
        description="Every core primitive against a fixture, so behaviour can be checked without hunting for a feature that uses it."
        actions={<Button variant="secondary" onClick={() => setConfirming("stale")}>Show a 409</Button>}
      />

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">Buttons</h2>
        <p>
          The product&apos;s most-used control, so its reference rendering lives here: primary for the
          one action a screen exists for, secondary for everything beside it, ghost where chrome would
          crowd a row, danger only on the destructive path. An icon-only control is an{" "}
          <code>.icon-button</code> with an <code>aria-label</code> — never a bare glyph.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger"><Trash2 size={14} aria-hidden /> Danger</Button>
          <Button disabled>Disabled</Button>
          <button type="button" className="icon-button" aria-label="Remove this fixture row"><X size={18} /></button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
          <Button size="sm">Small</Button>
          <Button>Medium</Button>
          <Button size="lg"><Plus size={16} aria-hidden /> Large</Button>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">Fields, inputs and toggles</h2>
        <p>
          Every labelled control is a <code>&lt;Field&gt;</code>: the label, the hint, and — once the
          server has answered — the error that replaces the hint so the two never argue. A checkbox is
          a <code>.checkbox-row</code>, whose box takes the accent colour rather than the OS one.
        </p>
        <div style={{ display: "grid", gap: 12, maxWidth: 460 }}>
          <Field label="Session title" required hint="Shown on the public agenda">
            <input defaultValue="Evaluating agents in production" />
          </Field>
          <Field label="Abstract" hint="Plain text here; the rich editor lives on the rich page">
            <textarea rows={3} defaultValue="Two years of eval harnesses, and what we would keep." />
          </Field>
          <Field label="Room" error="Pick a room before publishing" errorId="kitchen-sink-room-error">
            <input aria-describedby="kitchen-sink-room-error" defaultValue="" />
          </Field>
          <label className="checkbox-row">
            <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} />
            <span><b>Email the speaker</b><small>Sends as soon as the session is published</small></span>
          </label>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Switch checked={autoPublish} label="Publish sessions automatically" onClick={() => setAutoPublish((on) => !on)} />
            <span style={{ fontSize: "var(--text-sm)" }}>Publish sessions automatically</span>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">Tabs and filter strips</h2>
        <p>
          Two strips that look related and are not. Tabs own a panel, so they carry{" "}
          <code>role=&quot;tablist&quot;</code> and one tab stop — arrows move between them, and focus
          follows selection. A filter strip has no panel to control, so it is a named group of{" "}
          <code>aria-pressed</code> buttons instead. Chips are the same idea at one item each.
        </p>
        <div className="drawer-tabs" role="tablist" aria-label="Fixture sections" style={{ padding: 0 }}>
          {DEMO_TABS.map((candidate) => (
            <button
              key={candidate}
              id={`kitchen-sink-tab-${candidate}`}
              type="button"
              role="tab"
              aria-controls="kitchen-sink-tabpanel"
              aria-selected={tab === candidate}
              tabIndex={tab === candidate ? 0 : -1}
              className={tab === candidate ? "active" : ""}
              onKeyDown={(event) => moveRovingTab(event, DEMO_TABS, candidate, setTab)}
              onClick={() => setTab(candidate)}
            >
              {DEMO_TAB_LABEL[candidate]}
            </button>
          ))}
        </div>
        <div id="kitchen-sink-tabpanel" role="tabpanel" aria-labelledby={`kitchen-sink-tab-${tab}`} style={{ padding: "16px 0" }}>
          <p style={{ margin: 0 }}>The {DEMO_TAB_LABEL[tab].toLowerCase()} panel. Arrow keys move the selection; Tab leaves the strip.</p>
        </div>
        <div className="abstract-status-tabs" role="group" aria-label="Filter fixtures by stage">
          {DEMO_STAGES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={stage === option.value}
              className={stage === option.value ? "active" : ""}
              onClick={() => setStage(option.value)}
            >
              {option.label}<span>{option.count}</span>
            </button>
          ))}
        </div>
        <Field label="Tracks" group>
          <div className="chip-picker">
            {DEMO_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                aria-pressed={tags.includes(tag)}
                className={tags.includes(tag) ? "chip chip--selected" : "chip"}
                onClick={() => setTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}
              >
                {tag}
              </button>
            ))}
          </div>
        </Field>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">Status badges</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SUBMISSION_STATUSES.map((status) => <StatusBadge key={status} value={status} />)}
        </div>
        <div className="speaker-card" style={{ maxWidth: 420, marginTop: 16 }}>
          <Avatar initials="TJ" size="lg" />
          <div className="speaker-card-copy"><b>TJ Johnson</b><span>Speaker profile</span></div>
          <StatusBadge value="unconfirmed" />
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">Command palette</h2>
        <p>
          Fixed verbs and live results share one keyboard-navigable list. Psst — the palette also has
          a secret menu: it is fond of certain animals, a good espresso, and a proper afterparty.
        </p>
        <CommandPalette
          eventId="00000000-0000-4000-8000-000000000001"
          base="/events/00000000-0000-4000-8000-000000000001"
          role="organizer"
        />
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">Dash and TzTime</h2>
        <p>
          Empty values render <Dash />, never the string &quot;undefined&quot;. A time renders as{" "}
          <TzTime instant="2026-09-15T16:00:00Z" tz={TIMEZONE} style="long" /> — always with its zone
          label, because the reader is rarely in the event&apos;s zone.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">First-run hints</h2>
        <p>
          A pulsing beacon marks UI a first-time organizer may not have found yet. Clicking it opens a
          tip card; <b>Got it</b> retires that beacon for this browser, <b>Skip all tips</b> retires the
          whole scope. Acknowledged already? Reset brings the demo beacon back.
        </p>
        <FirstRunHints scope="kitchen-sink" ids={HINT_IDS}>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <Hint id="kitchen-sink:demo" title="This is a first-run hint" body="It waits until clicked, never blocks the UI underneath, and shows exactly once per browser." placement="bottom">
              <Button variant="secondary">A control with a tip</Button>
            </Hint>
            <Button variant="secondary" onClick={() => { resetHints("kitchen-sink", HINT_IDS); window.location.reload(); }}>Reset the demo hint</Button>
          </div>
        </FirstRunHints>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">DataTable</h2>
        <p>
          Sort <b>Rating</b> in both directions: unrated rows stay last either way. Filter to nothing
          to see the empty state, and hide a column — the choice survives a reload.
        </p>
        <DataTable
          columns={columns}
          data={data}
          enableSelection
          getRowLabel={(row) => `${row.code}, ${row.title}`}
          columnVisibilityKey="kitchen-sink"
          pageSize={10}
          toolbar={
            <SearchInput label="Search fixtures" placeholder="Search fixtures" value={search} onChange={setSearch} />
          }
          empty={
            <EmptyState
              icon={<Inbox size={20} />}
              title="Nothing matches that search"
              description="Clear the search to see the 25 fixture rows again."
              action={<Button onClick={() => setSearch("")}>Clear search</Button>}
            />
          }
        />
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">EmptyState</h2>
        <p>
          An empty surface names the next action, not the situation: &quot;wait for something to
          happen&quot; is what an empty state is for avoiding. First run gets the route that fills the
          screen; a filter that emptied it gets a way back.
        </p>
        <div className="panel" style={{ padding: 24 }}>
          <EmptyState
            icon={<Inbox size={26} />}
            title="No fixtures yet"
            description="Create one and it lands here — this is the first-run half of the pair."
            action={<Button><Plus size={14} aria-hidden /> Create a fixture</Button>}
          />
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">ConfirmDialog</h2>
        <Button variant="danger" onClick={() => setConfirming("destructive")}>Delete something</Button>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">Modal and Drawer</h2>
        <p>
          Both are native <code>&lt;dialog&gt;</code> elements opened with <code>showModal()</code>:
          focus is trapped, <kbd>Esc</kbd> closes them, and the control that opened one gets focus
          back on close. A modal interrupts to ask one question; a drawer sits beside the list it
          came from, so the row underneath stays readable.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={() => setPlainModalOpen(true)}>Open a modal</Button>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>Open a drawer</Button>
          <Button variant="secondary" onClick={() => setDateModalOpen(true)}>Open modal picker</Button>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">Toast</h2>
        <p>
          A toast confirms what just happened and then leaves. Errors stay long enough to read and are
          announced assertively; anything the organizer might want back carries an undo action rather
          than an apology.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={() => toast("Fixture row saved")}>Success toast</Button>
          <Button variant="secondary" onClick={() => toast("That row could not be saved. Try again.", { kind: "error" })}>Error toast</Button>
          <Button variant="secondary" onClick={() => toast("Fixture row deleted", { action: { label: "Undo", onClick: () => toast("Fixture row restored") } })}>Toast with an action</Button>
        </div>
      </section>

      <Modal
        open={plainModalOpen}
        onClose={() => setPlainModalOpen(false)}
        title="Rename this fixture"
        description="The plain shape: a title, a sentence of context, one field, and the two footer buttons in reading order."
        footer={<>
          <Button variant="secondary" onClick={() => setPlainModalOpen(false)}>Cancel</Button>
          <Button onClick={() => { setPlainModalOpen(false); toast("Fixture renamed"); }}>Save changes</Button>
        </>}
      >
        <Field label="Name">
          <input defaultValue="Fixture submission 1" />
        </Field>
      </Modal>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Fixture submission 1">
        <div className="drawer-content">
          <p className="long-copy">
            The submission drawer&apos;s shell. Everything a feature adds — the decision row, the tab
            strip, the review comments — sits inside this same panel, which is why the header, the
            close button and the scroll behaviour are worth having in one place.
          </p>
        </div>
      </Drawer>

      <Modal open={dateModalOpen} onClose={() => setDateModalOpen(false)} title="Modal date/time fixture">
        <label className="field">
          <span>Starts at</span>
          <DateTimePicker value={sampleDate} onChange={setSampleDate} tz={TIMEZONE} />
        </label>
      </Modal>

      <ConfirmDialog
        open={confirming !== null}
        variant={confirming === "stale" ? "stale" : "destructive"}
        title={confirming === "stale" ? "This changed while you were looking at it" : "Delete this fixture row?"}
        body={confirming === "stale"
          ? "Someone else saved a newer version. Reload to see theirs — there is no force option, because you cannot see what you would overwrite."
          : "Nothing is actually deleted here; the dialog is the point."}
        confirmLabel="Delete row"
        onConfirm={() => {
          setConfirming(null);
          if (confirming === "stale") window.location.reload();
        }}
        onCancel={() => setConfirming(null)}
      />
    </main>
  );
}
