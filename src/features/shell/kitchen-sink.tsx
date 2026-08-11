"use client";

import { Inbox } from "lucide-react";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { SUBMISSION_STATUSES } from "@/shared/contracts";
import { ColorChip } from "@/shared/ui/app/color-chip";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { DataTable, nullsLast } from "@/shared/ui/app/data-table";
import { Dash } from "@/shared/ui/app/dash";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Button, EmptyState, PageHeader, StatusBadge } from "@/shared/ui/ui-kit";

const TIMEZONE = "America/Los_Angeles";

type DemoRow = {
  id: string;
  code: string;
  title: string;
  track: { label: string; color: string } | null;
  rating: number | null;
  submittedAt: string;
};

const TRACKS = [
  { label: "Agents", color: "#6958d7" },
  { label: "Evals", color: "#2f8f5b" },
  { label: "Infra", color: "#b6742a" },
];

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
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DemoRow[]>([]);
  const [confirming, setConfirming] = useState<"destructive" | "stale" | null>(null);

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
        ? <ColorChip label={row.original.track.label} color={row.original.track.color} />
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
    <main className="page">
      <PageHeader
        eyebrow="PLATFORM"
        title="Kitchen sink"
        description="Every core primitive against a fixture, so behaviour can be checked without hunting for a feature that uses it."
        actions={<Button variant="secondary" onClick={() => setConfirming("stale")}>Show a 409</Button>}
      />

      <section style={{ marginBottom: 28 }}>
        <h2 className="section-title">Status badges</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SUBMISSION_STATUSES.map((status) => <StatusBadge key={status} value={status} />)}
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 className="section-title">Dash and TzTime</h2>
        <p>
          Empty values render <Dash />, never the string &quot;undefined&quot;. A time renders as{" "}
          <TzTime instant="2026-09-15T16:00:00Z" tz={TIMEZONE} style="long" /> — always with its zone
          label, because the reader is rarely in the event&apos;s zone.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
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
          onSelectionChange={setSelected}
          columnVisibilityKey="kitchen-sink"
          pageSize={10}
          toolbar={
            <div className="table-search">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search fixtures"
                aria-label="Search fixtures"
              />
            </div>
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
        <p style={{ marginTop: 10 }}>{selected.length} row(s) selected on this page.</p>
      </section>

      <section>
        <h2 className="section-title">ConfirmDialog</h2>
        <Button variant="danger" onClick={() => setConfirming("destructive")}>Delete something</Button>
      </section>

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
