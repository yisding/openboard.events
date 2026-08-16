"use client";

import { ExternalLink, MoreHorizontal, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/shared/ui/app/data-table";
import { StatTile } from "@/shared/ui/app/stat-tile";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Button, EmptyState, ProgressBar, StatusBadge } from "@/shared/ui/ui-kit";
import type { StatusBadgeValue } from "@/shared/ui/status-badge";
import { AIRTABLE_COPY, describeDuration, statsRecordCount, tileCounts } from "../copy";
import {
  airtableBaseUrl,
  type AirtableConnectionSummary,
  type SyncRunSummary,
} from "../schemas";
import { connectedAccountLabel } from "../scopes";

/**
 * A run status is never printed. Four backend values, four authored labels and
 * tones, chosen once here — the same reason `contact-detail-view.tsx` renders
 * `<StatusBadge value={session.status} />` instead of `{session.status}`.
 */
const RUN_BADGES = {
  running: "processing",
  success: "completed",
  failed: "failed",
  blocked: "blocked",
} as const satisfies Record<SyncRunSummary["status"], StatusBadgeValue>;

/**
 * The connected state: what is in the base, when it last ran, and one click to
 * open it.
 *
 * The base name is a link in the card header rather than an item in the ⋯ menu
 * because it is the most-clicked thing on this page — an organizer comes here
 * to *go to Airtable* far more often than to change how the sync behaves.
 */
export function SyncStatusCard({
  connection,
  latestRun,
  runs,
  timezone,
  syncing,
  slow,
  now,
  onSyncNow,
  onOpenOptions,
  onToggleAutomatic,
  onDisconnect,
}: {
  connection: AirtableConnectionSummary;
  latestRun: SyncRunSummary | null;
  runs: SyncRunSummary[];
  timezone: string;
  syncing: boolean;
  slow: boolean;
  now: number;
  onSyncNow: () => void;
  onOpenOptions: () => void;
  onToggleAutomatic: () => void;
  onDisconnect: () => void;
}) {
  const copy = AIRTABLE_COPY.connected;
  const stats = latestRun?.stats;
  const tiles = stats ? tileCounts(stats) : null;
  const done = stats ? statsRecordCount(stats) : 0;
  const remaining = stats?.deferred ?? 0;
  const total = done + remaining;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const nextSyncMs = new Date(connection.nextSyncAfter).getTime() - now;
  const lastSyncedMs = connection.lastSyncedAt ? now - new Date(connection.lastSyncedAt).getTime() : null;

  const columns = useMemo<Array<ColumnDef<SyncRunSummary, unknown>>>(() => [
    {
      id: "startedAt",
      header: copy.columnWhen,
      accessorKey: "startedAt",
      cell: ({ row }) => <TzTime instant={row.original.startedAt} tz={timezone} style="date" secondary="time" />,
    },
    {
      id: "trigger",
      header: copy.columnTrigger,
      accessorKey: "trigger",
      cell: ({ row }) => <span>{AIRTABLE_COPY.trigger[row.original.trigger]}</span>,
    },
    {
      id: "status",
      header: copy.columnResult,
      accessorKey: "status",
      cell: ({ row }) => (
        <div className="airtable-run-result">
          <StatusBadge value={RUN_BADGES[row.original.status]} />
          {row.original.error && <small>{row.original.error}</small>}
        </div>
      ),
    },
    {
      id: "records",
      header: copy.columnRecords,
      accessorKey: "id",
      cell: ({ row }) => <span>{statsRecordCount(row.original.stats)}</span>,
    },
  ], [copy, timezone]);

  return (
    <section className="panel settings-section airtable-card">
      <header className="airtable-card__header">
        <div>
          <span className="airtable-card__eyebrow">{copy.heading}</span>
          <h2>
            {connection.baseId ? (
              <a href={airtableBaseUrl(connection.baseId)} target="_blank" rel="noopener noreferrer">
                {connection.baseName ?? copy.openBase} <ExternalLink size={14} aria-hidden />
              </a>
            ) : (
              connection.baseName ?? copy.openBase
            )}
          </h2>
          <p>
            {copy.account(connectedAccountLabel(connection.airtableUserId, connection.accountEmail))}
            {" · "}
            {copy.tokenHint(connection.tokenHint)}
          </p>
        </div>
        <div className="airtable-card__actions">
          <Button size="sm" onClick={onSyncNow} disabled={syncing}>
            <RefreshCw size={14} aria-hidden /> {syncing ? copy.syncing : copy.syncNow}
          </Button>
          <details className="airtable-menu">
            <summary aria-label={copy.menu}><MoreHorizontal size={16} aria-hidden /></summary>
            <div className="airtable-menu__items">
              <button type="button" onClick={onOpenOptions}>{copy.whatWeSync}</button>
              <button type="button" onClick={onToggleAutomatic}>
                {connection.syncEnabled ? copy.pauseAutomatic : copy.resumeAutomatic}
              </button>
              <button type="button" className="is-danger" onClick={onDisconnect}>{copy.disconnect}</button>
            </div>
          </details>
        </div>
      </header>

      <div className="airtable-card__body">
        {syncing && (
          <div className="airtable-progress" role="status">
            <ProgressBar value={percent} label={AIRTABLE_COPY.syncing.progressLabel} />
            <small>{total === 0 ? AIRTABLE_COPY.syncing.starting : AIRTABLE_COPY.syncing.subtitle(done, total)}</small>
            {slow && <small>{AIRTABLE_COPY.syncing.slow}</small>}
          </div>
        )}

        <div className="airtable-tiles">
          <StatTile label={copy.tiles.sessions} value={tiles?.sessions ?? null} />
          <StatTile label={copy.tiles.people} value={tiles?.people ?? null} />
          <StatTile label={copy.tiles.proposals} value={tiles?.proposals ?? null} />
          <StatTile label={copy.tiles.lookups} value={tiles?.lookups ?? null} hint={copy.lookupsHint} />
        </div>

        <p className="airtable-card__timing">
          {lastSyncedMs === null ? copy.neverSynced : copy.lastSync(describeDuration(lastSyncedMs))}
          {" "}
          {!connection.syncEnabled
            ? copy.automaticPaused
            : nextSyncMs <= 0
              ? copy.nextSyncDue
              : copy.nextSync(describeDuration(nextSyncMs))}
        </p>

        {!syncing && latestRun?.status === "success" && remaining > 0 && (
          <div className="airtable-note airtable-note--amber">
            <b>{AIRTABLE_COPY.deferred.title}</b>
            <span>{AIRTABLE_COPY.deferred.body(done, remaining)}</span>
          </div>
        )}
      </div>

      <details className="airtable-runs">
        <summary>{copy.recentHeading}</summary>
        <DataTable
          columns={columns}
          data={runs}
          getRowId={(run) => run.id}
          empty={<EmptyState icon={<RefreshCw size={20} />} title={copy.recentEmptyTitle} description={copy.recentEmptyBody} />}
        />
      </details>
    </section>
  );
}
