"use client";

import { AlertTriangle, Table2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EventId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { isDefinitiveWriteFailure } from "@/shared/lib/errors";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { Button, Drawer, EmptyState, Switch } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { AIRTABLE_COPY, statsRecordCount, tableRecordCount } from "../copy";
import { TABLE_PLANS, type SyncTableKey, type TablePlan } from "../plan";
import {
  airtableBaseChoiceResultSchema,
  airtableConnectionSummarySchema,
  airtableDisconnectedSchema,
  airtableLatestRunSchema,
  airtableStatusSchema,
  type AirtableConnectionOptionsDTO,
  type AirtableConnectionSummary,
  type SyncRunSummary,
} from "../schemas";
import { ConnectDialog } from "./ConnectDialog";
import { ManualFieldList, manualFieldListText } from "./SchemaIssueList";
import { SyncStatusCard } from "./SyncStatusCard";

const RUN_POLL_MS = 1500;
const CLOCK_TICK_MS = 20_000;
const SLOW_AFTER_MS = 90_000;

type OptionKey = keyof AirtableConnectionOptionsDTO;

const OPTION_ROWS: readonly { key: OptionKey; copy: { label: string; hint: string } }[] = [
  { key: "includeEmail", copy: AIRTABLE_COPY.options.includeEmail },
  { key: "includeBio", copy: AIRTABLE_COPY.options.includeBio },
  { key: "includeHeadshots", copy: AIRTABLE_COPY.options.includeHeadshots },
  { key: "includePronouns", copy: AIRTABLE_COPY.options.includePronouns },
  { key: "includeGender", copy: AIRTABLE_COPY.options.includeGender },
  { key: "pruneRemoved", copy: AIRTABLE_COPY.options.pruneRemoved },
];

/**
 * The whole Airtable settings surface: empty, connecting, connected, syncing,
 * needing attention, blocked, and disconnecting.
 *
 * Every write follows the repo's mutation contract — `api(...)` with a zod
 * output schema, `isDefinitiveWriteFailure` on the way out, and a
 * `toast(message, { kind: "error" })` on every failure path with a sentence
 * that names what failed. There is no generic fallback string in this file,
 * because there is no failure here whose cause we do not know.
 *
 * The panel never sees a token. `AirtableConnectionSummary` has no field for
 * one, so the strongest statement about that is a type rather than a promise.
 */
export function AirtableSettingsPanel({
  eventId,
  eventName,
  timezone,
  initialConnection,
  initialRuns,
}: {
  eventId: EventId;
  eventName: string;
  timezone: string;
  initialConnection: AirtableConnectionSummary | null;
  initialRuns: SyncRunSummary[];
}) {
  const { toast } = useToast();
  const [connection, setConnection] = useState(initialConnection);
  const [runs, setRuns] = useState(initialRuns);
  const [latestRun, setLatestRun] = useState<SyncRunSummary | null>(initialRuns[0] ?? null);
  const [syncing, setSyncing] = useState(false);
  const [slow, setSlow] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  // Which step the wizard opens on when the panel — rather than the connection's
  // own state — knows where the organizer needs to land. Set by the
  // base-missing banner, whose only recovery is the base picker.
  const [connectStartAt, setConnectStartAt] = useState<"token" | "base" | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const syncStartedAt = useRef<number | null>(null);

  useUnsavedWorkGuard(syncing, { blocking: syncing });

  // Relative phrasings ("4 minutes ago", "in about 11 minutes") go stale in
  // place otherwise, and a status card whose clock stopped is worse than one
  // with no clock.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const refreshStatus = useCallback(async () => {
    const status = await api(`events/${eventId}/airtable`, airtableStatusSchema);
    setConnection(status.connection);
    setRuns(status.runs);
    setLatestRun(status.runs[0] ?? null);
  }, [eventId]);

  const pollRun = useCallback(async () => {
    try {
      const result = await api(`events/${eventId}/airtable/sync`, airtableLatestRunSchema);
      if (result.run) setLatestRun(result.run);
    } catch {
      // A dropped poll changes nothing: the POST still in flight is the
      // authority on this run, and the next tick asks again.
    }
    if (syncStartedAt.current !== null && Date.now() - syncStartedAt.current > SLOW_AFTER_MS) setSlow(true);
  }, [eventId]);

  useEffect(() => {
    if (!syncing) return;
    const timer = window.setInterval(() => { void pollRun(); }, RUN_POLL_MS);
    return () => window.clearInterval(timer);
  }, [syncing, pollRun]);

  async function syncNow() {
    if (syncing) return;
    setSyncing(true);
    setSlow(false);
    syncStartedAt.current = Date.now();
    try {
      const result = await api(`events/${eventId}/airtable/sync`, airtableLatestRunSchema, { method: "POST" });
      if (result.run) setLatestRun(result.run);
      const records = result.run ? statsRecordCount(result.run.stats) : 0;
      const changed = result.run ? result.run.stats.created + result.run.stats.updated : 0;
      if (result.run?.status === "success") {
        toast(changed === 0 ? AIRTABLE_COPY.connected.nothingToDoToast : AIRTABLE_COPY.connected.syncedToast(records));
      } else if (result.run?.error) {
        toast(result.run.error, { kind: "error" });
      }
    } catch (caught) {
      if (isDefinitiveWriteFailure(caught)) {
        toast(caught.code === "CONFLICT" ? AIRTABLE_COPY.errors.conflict : caught.message, { kind: "error" });
      } else {
        toast(AIRTABLE_COPY.errors.syncUnknownOutcome, { kind: "error" });
      }
    } finally {
      setSyncing(false);
      syncStartedAt.current = null;
      try {
        await refreshStatus();
      } catch {
        toast(AIRTABLE_COPY.errors.statusUnavailable, { kind: "error" });
      }
    }
  }

  async function patchOptions(patch: Partial<AirtableConnectionOptionsDTO> & { syncEnabled?: boolean }, message: string) {
    if (busy || !connection) return;
    const previous = connection;
    const { syncEnabled, ...optionsPatch } = patch;
    setBusy(true);
    // Optimistic, then reconciled with the server's own row. `syncEnabled` is
    // a column on the connection, not a member of `options` — folding it into
    // the options object would leave a key there that the server never returns.
    setConnection({
      ...connection,
      options: { ...connection.options, ...optionsPatch },
      ...(syncEnabled === undefined ? {} : { syncEnabled }),
    });
    try {
      const updated = await api(`events/${eventId}/airtable`, airtableConnectionSummarySchema, { method: "PATCH", body: patch });
      setConnection(updated);
      toast(message);
    } catch (caught) {
      setConnection(previous);
      if (isDefinitiveWriteFailure(caught)) toast(caught.message, { kind: "error" });
      else toast(AIRTABLE_COPY.errors.optionsFailed, { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    setConfirmDisconnect(false);
    try {
      await api(`events/${eventId}/airtable`, airtableDisconnectedSchema, { method: "DELETE" });
      setConnection(null);
      setLatestRun(null);
      toast(AIRTABLE_COPY.disconnect.done);
    } catch (caught) {
      if (isDefinitiveWriteFailure(caught)) toast(AIRTABLE_COPY.errors.disconnectFailed, { kind: "error" });
      else toast(AIRTABLE_COPY.errors.disconnectUnknown, { kind: "error" });
    } finally {
      setBusy(false);
      // Outside the `try`, the way `syncNow` does it. Inside, a status refresh
      // that failed *after* the DELETE had already succeeded toasted
      // "we couldn't disconnect" over a connection that was gone from the
      // screen — an error naming an operation that worked.
      await refreshStatus();
    }
  }

  // "Rebuild it" is a re-select of the base already attached. `ensureBaseSchema`
  // is create-only and never renames, retypes, or deletes, so running it a
  // second time costs a handful of meta calls and can do nothing worse.
  async function rebuildSchema() {
    if (rebuilding || !connection?.baseId) return;
    setRebuilding(true);
    try {
      const result = await api(`events/${eventId}/airtable/bases`, airtableBaseChoiceResultSchema, {
        method: "POST",
        body: { action: "select", baseId: connection.baseId },
      });
      setConnection(result.connection);
      if (result.schema.ok) toast(AIRTABLE_COPY.blocked.rebuilt);
      else toast(result.schema.issues[0]?.instruction ?? AIRTABLE_COPY.blocked.withoutScope, { kind: "error" });
    } catch (caught) {
      if (isDefinitiveWriteFailure(caught)) toast(caught.message, { kind: "error" });
      else toast(AIRTABLE_COPY.errors.unknownOutcome, { kind: "error" });
    } finally {
      setRebuilding(false);
    }
  }

  async function copyFieldList() {
    try {
      await navigator.clipboard.writeText(manualFieldListText());
      toast(AIRTABLE_COPY.blocked.copied);
    } catch {
      toast(AIRTABLE_COPY.blocked.copyFailed, { kind: "error" });
    }
  }

  const connected = connection !== null && connection.status !== "pending" && connection.baseId !== null;
  const canManageSchema = connection?.scopes.includes("schema.bases:write") ?? false;
  const heldTable = latestRun?.stats.perTable.find((table) => table.purgeHeld > 0);
  // `key` comes back out of persisted run statistics, so it is a string that was
  // a `SyncTableKey` when it was written. Resolved rather than asserted: a run
  // stored before a table was renamed would otherwise index `TABLE_PLANS` to
  // `undefined` and take the whole settings panel down on `.displayName`.
  const heldPlan = heldTable ? TABLE_PLANS[heldTable.key as SyncTableKey] as TablePlan | undefined : undefined;
  // A deleted base leaves the connection `connected` and the run `blocked`, so
  // the run's own key is what tells these two blocked states apart.
  const baseMissing = latestRun?.status === "blocked" && connection?.lastErrorKey === "base_missing";
  // The banner below is specifically about the *shape* of the base, which is why
  // it offers "Rebuild it". Gating it on `blocked` alone made it the catch-all
  // for every blocked reason: it survived a successful rebuild — which clears
  // `lastErrorKey` but cannot retroactively unblock the run that is still the
  // latest one — so the organizer read "Your base matches again" and "Your base
  // needs one change" at the same time, with a button that could only repeat
  // work already done. It also offered that button for `records_rejected`, where
  // rebuilding the schema is not the remedy. Those keep their sentence in the
  // run history, which prints every run's error.
  const schemaBlocked = latestRun?.status === "blocked"
    && (connection?.lastErrorKey === "schema_drifted" || connection?.lastErrorKey === "missing_scope");

  function openConnect(startAt: "token" | "base") {
    setConnectStartAt(startAt);
    setConnectOpen(true);
  }

  return (
    <>
      {!connected && (
        <section className="panel settings-section airtable-empty">
          <EmptyState
            icon={<Table2 size={20} />}
            title={AIRTABLE_COPY.empty.title}
            description={AIRTABLE_COPY.empty.description}
            action={
              <Button onClick={() => setConnectOpen(true)}>
                {connection?.status === "pending" ? AIRTABLE_COPY.empty.resume : AIRTABLE_COPY.empty.connect}
              </Button>
            }
          />
          <ol className="airtable-rail">
            {AIRTABLE_COPY.empty.steps.map((step) => (
              <li key={step.number}><span>{step.number}</span> {step.label}</li>
            ))}
          </ol>
          {connection?.status === "pending" && <p className="airtable-note">{AIRTABLE_COPY.empty.resumeNote}</p>}
        </section>
      )}

      {connected && connection && connection.status === "needs_attention" && (
        <div className="airtable-attention" role="alert">
          <AlertTriangle size={17} aria-hidden />
          <div>
            <b>{AIRTABLE_COPY.needsAttention.title}</b>
            <span>{AIRTABLE_COPY.needsAttention.body}</span>
          </div>
          <Button size="sm" variant="secondary" onClick={() => openConnect("token")}>{AIRTABLE_COPY.needsAttention.action}</Button>
        </div>
      )}

      {connected && connection && baseMissing && (
        <div className="airtable-attention" role="status">
          <AlertTriangle size={17} aria-hidden />
          <div>
            <b>{AIRTABLE_COPY.baseMissing.title}</b>
            <span>{AIRTABLE_COPY.baseMissing.body}</span>
          </div>
          <Button size="sm" variant="secondary" onClick={() => openConnect("base")}>
            {AIRTABLE_COPY.baseMissing.action}
          </Button>
        </div>
      )}

      {connected && connection && schemaBlocked && !baseMissing && (
        <div className="airtable-attention" role="status">
          <AlertTriangle size={17} aria-hidden />
          <div>
            <b>{AIRTABLE_COPY.blocked.title}</b>
            <span>{latestRun.error}</span>
            <span>{canManageSchema ? AIRTABLE_COPY.blocked.withScope : AIRTABLE_COPY.blocked.withoutScope}</span>
            {!canManageSchema && <ManualFieldList />}
          </div>
          {canManageSchema
            ? <Button size="sm" variant="secondary" disabled={rebuilding} onClick={() => void rebuildSchema()}>
                {rebuilding ? AIRTABLE_COPY.blocked.rebuilding : AIRTABLE_COPY.blocked.rebuild}
              </Button>
            : <Button size="sm" variant="secondary" onClick={() => void copyFieldList()}>{AIRTABLE_COPY.blocked.copyFields}</Button>}
        </div>
      )}

      {connected && connection && (latestRun?.stats.orphans ?? 0) > 0 && !connection.options.pruneRemoved && (
        <div className="airtable-attention" role="status">
          <AlertTriangle size={17} aria-hidden />
          <div><span>{AIRTABLE_COPY.orphans.body(latestRun?.stats.orphans ?? 0)}</span></div>
          <Button size="sm" variant="secondary" onClick={() => setConfirmPurge(true)}>{AIRTABLE_COPY.orphans.action}</Button>
        </div>
      )}

      {connected && heldTable && heldPlan && (
        <div className="airtable-attention" role="status">
          <AlertTriangle size={17} aria-hidden />
          <div>
            <span>{AIRTABLE_COPY.orphans.held(
              heldTable.purgeHeld,
              tableRecordCount(heldTable) + heldTable.purgeHeld,
              heldPlan.displayName,
            )}</span>
          </div>
        </div>
      )}

      {connected && connection && (
        <SyncStatusCard
          connection={connection}
          latestRun={latestRun}
          runs={runs}
          timezone={timezone}
          syncing={syncing}
          slow={slow}
          now={now}
          onSyncNow={() => void syncNow()}
          onOpenOptions={() => setOptionsOpen(true)}
          onToggleAutomatic={() => void patchOptions(
            { syncEnabled: !connection.syncEnabled },
            connection.syncEnabled ? AIRTABLE_COPY.connected.automaticPaused : AIRTABLE_COPY.options.saved,
          )}
          onDisconnect={() => setConfirmDisconnect(true)}
        />
      )}

      <ConnectDialog
        eventId={eventId}
        baseNameSuggestion={`${eventName} — Openboard`}
        open={connectOpen}
        startAt={connectStartAt ?? (connection?.status === "pending" && connection.scopes.length > 0 ? "base" : "token")}
        connection={connection}
        onClose={() => {
          setConnectOpen(false);
          setConnectStartAt(null);
          void refreshStatus().catch(() => toast(AIRTABLE_COPY.errors.statusUnavailable, { kind: "error" }));
        }}
        onConnection={setConnection}
      />

      <Drawer open={optionsOpen} onClose={() => setOptionsOpen(false)} title={AIRTABLE_COPY.options.title}>
        <div className="drawer-body">
          <p>{AIRTABLE_COPY.options.lead}</p>
          {OPTION_ROWS.map((row) => (
            <div key={row.key} className="inline-setting">
              <div><b>{row.copy.label}</b><small>{row.copy.hint}</small></div>
              <Switch
                checked={connection?.options[row.key] ?? false}
                label={row.copy.label}
                disabled={busy || !connection}
                onClick={() => void patchOptions({ [row.key]: !(connection?.options[row.key] ?? false) }, AIRTABLE_COPY.options.saved)}
              />
            </div>
          ))}
          <p className="airtable-note">{AIRTABLE_COPY.options.footer}</p>
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDisconnect}
        title={AIRTABLE_COPY.disconnect.title}
        body={AIRTABLE_COPY.disconnect.body(connection?.baseName ?? AIRTABLE_COPY.connected.openBase)}
        confirmLabel={AIRTABLE_COPY.disconnect.confirm}
        onConfirm={() => void disconnect()}
        onCancel={() => setConfirmDisconnect(false)}
      />

      <ConfirmDialog
        open={confirmPurge}
        title={AIRTABLE_COPY.orphans.confirmTitle}
        body={AIRTABLE_COPY.orphans.confirmBody}
        confirmLabel={AIRTABLE_COPY.orphans.confirmLabel}
        onConfirm={() => {
          setConfirmPurge(false);
          void patchOptions({ pruneRemoved: true }, AIRTABLE_COPY.orphans.enabled);
        }}
        onCancel={() => setConfirmPurge(false)}
      />
    </>
  );
}
