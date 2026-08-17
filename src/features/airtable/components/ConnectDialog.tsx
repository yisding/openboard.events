"use client";

import { Check, ExternalLink, Loader2, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EventId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { isAppError, isDefinitiveWriteFailure } from "@/shared/lib/errors";
import { LoadFailure } from "@/shared/ui/app/load-failure";
import { SkeletonText } from "@/shared/ui/app/skeleton";
import { Button, Field, Modal, ProgressBar } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { AIRTABLE_COPY, SYNC_TABLE_CHECKLIST, statsRecordCount, tableRecordCount, tableStats } from "../copy";
import { SYNC_TABLE_ORDER } from "../plan";
import { AIRTABLE_TOKEN_URL } from "../scopes";
import {
  airtableBaseChoiceResultSchema,
  airtableBaseListSchema,
  airtableLatestRunSchema,
  airtableTokenResultSchema,
  airtableBaseUrl,
  type AirtableBaseSummary,
  type AirtableConnectionSummary,
  type AirtableSchemaReport,
  type AirtableTokenVerdict,
  type SyncRunSummary,
} from "../schemas";
import { ScopeChecklist } from "./ScopeChecklist";
import { ManualFieldList, SchemaIssueList, manualFieldListText } from "./SchemaIssueList";

const TOKEN_SHAPE = /^pat[A-Za-z0-9._-]{10,}$/u;
const VALIDATE_DEBOUNCE_MS = 500;
const RUN_POLL_MS = 1500;

type TokenState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "valid"; verdict: AirtableTokenVerdict }
  | { kind: "rejected"; message: string };

type Step = "token" | "base" | "run";

/**
 * The self-serve connect flow: paste a token, pick a base, watch it fill.
 *
 * The shape of this dialog is decided by one property of the server: the token
 * is sealed the instant Airtable confirms it, into a `pending` connection row.
 * Everything after step 1 — listing bases, creating one, building tables,
 * syncing — opens that sealed token server-side. So the browser holds a
 * personal access token for the length of one request and never again, and
 * "add the missing scope on the same token" is a promise we can keep without
 * making anyone retype eighty characters.
 *
 * Step 3 is not an animation. `runAirtableSyncForEventIn` writes per-table
 * counters after every table, and this polls them, so each line resolves when
 * that table is genuinely in the customer's base.
 */
export function ConnectDialog({
  eventId,
  baseNameSuggestion,
  open,
  startAt,
  connection,
  onClose,
  onConnection,
}: {
  eventId: EventId;
  /** Pre-fills the "create a base for me" name with `"{Event name} — Openboard"`. */
  baseNameSuggestion: string;
  open: boolean;
  startAt: Step;
  connection: AirtableConnectionSummary | null;
  onClose: () => void;
  onConnection: (connection: AirtableConnectionSummary) => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>(startAt);
  /**
   * The step this wizard *opened* on, frozen until it reopens.
   *
   * `startAt` is recomputed by the panel from the connection, and the connection
   * changes underneath this dialog: sealing a token mid-flow turns a `pending`
   * row with scopes into one whose natural entry point is the base picker. Read
   * live, that would tell "Next" the organizer had arrived at step 2 already —
   * and a token missing `data.records:write` would walk straight past the one
   * check that exists to stop it.
   */
  const [entryStep, setEntryStep] = useState<Step>(startAt);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [tokenState, setTokenState] = useState<TokenState>({ kind: "idle" });
  const [scopes, setScopes] = useState<readonly string[]>(connection?.scopes ?? []);
  const [canManageSchema, setCanManageSchema] = useState(false);

  const [bases, setBases] = useState<AirtableBaseSummary[] | null>(null);
  const [basesError, setBasesError] = useState<string | null>(null);
  const [choice, setChoice] = useState<"existing" | "create">("existing");
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [newBaseName, setNewBaseName] = useState(baseNameSuggestion);
  const [workspaceId, setWorkspaceId] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [baseId, setBaseId] = useState<string | null>(connection?.baseId ?? null);
  const [baseName, setBaseName] = useState<string | null>(connection?.baseName ?? null);
  const [schemaReport, setSchemaReport] = useState<AirtableSchemaReport | null>(null);
  const [run, setRun] = useState<SyncRunSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const validatedRef = useRef<string | null>(null);
  /*
   * The debounce cancels timers, not requests already in flight, so two
   * validations can overlap whenever the organizer edits a token that had
   * already started one — a paste followed by a correction is enough. Both then
   * call `setTokenState` in *arrival* order, and a late "valid" for the token
   * they abandoned would re-enable Next against a verdict this token never
   * earned. Only the newest request is allowed to speak.
   */
  const validationSeqRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setStep(startAt);
    setEntryStep(startAt);
    setTokenState({ kind: "idle" });
    setToken("");
    setShowToken(false);
    setFieldError(null);
    validatedRef.current = null;
    setScopes(connection?.scopes ?? []);
    setBaseId(connection?.baseId ?? null);
    setBaseName(connection?.baseName ?? null);
    setCanManageSchema((connection?.scopes ?? []).includes("schema.bases:write"));
    // Step 2 and 3 are reset too, and that matters rather than being tidiness:
    // `bases` is the list *one particular token* could see, and it is only
    // fetched while it is still null. A second pass through this wizard — a
    // different token pasted after a "this token can't see any bases" dead end,
    // or a reconnect after a disconnect — would otherwise render the previous
    // token's list (or its emptiness) and never ask Airtable again, with a
    // `selectedBaseId` the new token may have no access to.
    setBases(null);
    setBasesError(null);
    // Retires any validation still in flight from the previous pass, so its
    // answer cannot land on this one.
    validationSeqRef.current += 1;
    setChoice("existing");
    setSelectedBaseId(null);
    setSchemaReport(null);
    setRun(null);
    setSyncing(false);
    // Deliberately keyed on `open` alone: reopening resets the wizard, but a
    // connection summary arriving mid-flow (the token step just sealed one)
    // must not wipe the step the organizer is standing on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* ---- Step 1: live validation ---- */

  const validateToken = useCallback(async (candidate: string) => {
    const seq = validationSeqRef.current + 1;
    validationSeqRef.current = seq;
    const isCurrent = () => validationSeqRef.current === seq;
    setTokenState({ kind: "checking" });
    try {
      const result = await api(`events/${eventId}/airtable/token`, airtableTokenResultSchema, {
        method: "POST",
        body: { token: candidate },
      });
      if (!isCurrent()) return;
      validatedRef.current = candidate;
      setTokenState({ kind: "valid", verdict: result.verdict });
      setScopes(result.verdict.scopes);
      setCanManageSchema(result.verdict.canManageSchema);
      onConnection(result.connection);
    } catch (caught) {
      if (!isCurrent()) return;
      if (isDefinitiveWriteFailure(caught)) {
        setTokenState({
          kind: "rejected",
          message: caught.code === "RATE_LIMITED" ? AIRTABLE_COPY.token.rateLimited : caught.message,
        });
      } else {
        // Nothing was stored, so there is no unconfirmed write to recover —
        // the honest report is that we could not reach Airtable to ask.
        setTokenState({ kind: "idle" });
        toast(AIRTABLE_COPY.token.unreachable, { kind: "error" });
      }
    }
  }, [eventId, onConnection, toast]);

  useEffect(() => {
    if (!open || step !== "token") return;
    const candidate = token.trim();
    if (!TOKEN_SHAPE.test(candidate) || candidate === validatedRef.current) return;
    const timer = window.setTimeout(() => { void validateToken(candidate); }, VALIDATE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, step, token, validateToken]);

  /* ---- Step 2: the bases this token can see ---- */

  /*
   * `bases === null` is the only "not loaded yet" signal, so a failed fetch must
   * leave it null. Setting it to `[]` on failure said two untrue things at once:
   * that the load had finished, and that this token can see no bases — which is
   * the branch that forces "create a new base for me" and, without
   * `schema.bases:write`, a wizard with no way forward. A network blip is not a
   * verdict about the organizer's Airtable account. The error is held separately
   * and gates the effect, so the retry below is what asks again.
   */
  const loadBases = useCallback(async () => {
    setBasesError(null);
    try {
      const result = await api(`events/${eventId}/airtable/bases`, airtableBaseListSchema);
      setBases(result.bases);
      if (result.bases.length === 0) setChoice("create");
    } catch (caught) {
      setBasesError(isAppError(caught) ? caught.message : AIRTABLE_COPY.base.listFailed);
    }
  }, [eventId]);

  useEffect(() => {
    if (!open || step !== "base" || bases !== null || basesError !== null) return;
    void loadBases();
  }, [open, step, bases, basesError, loadBases]);

  /* ---- Step 3: the first sync, watched live ---- */

  const pollRun = useCallback(async () => {
    try {
      const result = await api(`events/${eventId}/airtable/sync`, airtableLatestRunSchema);
      if (result.run) setRun(result.run);
    } catch {
      // A dropped poll is not an event. The POST below is the authority on
      // whether this run finished, and it is still in flight.
    }
  }, [eventId]);

  useEffect(() => {
    if (!syncing) return;
    const timer = window.setInterval(() => { void pollRun(); }, RUN_POLL_MS);
    return () => window.clearInterval(timer);
  }, [syncing, pollRun]);

  const startFirstSync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await api(`events/${eventId}/airtable/sync`, airtableLatestRunSchema, { method: "POST" });
      if (result.run) setRun(result.run);
    } catch (caught) {
      if (isDefinitiveWriteFailure(caught) && caught.code === "CONFLICT") {
        toast(AIRTABLE_COPY.errors.conflict, { kind: "error" });
        await pollRun();
      } else if (isDefinitiveWriteFailure(caught)) {
        toast(caught.message, { kind: "error" });
        await pollRun();
      } else {
        toast(AIRTABLE_COPY.errors.syncUnknownOutcome, { kind: "error" });
        await pollRun();
      }
    } finally {
      setSyncing(false);
    }
  }, [eventId, pollRun, toast]);

  async function submitBase() {
    if (busy) return;
    setFieldError(null);
    const body = choice === "create"
      ? { action: "create" as const, workspaceId: workspaceId.trim(), name: newBaseName.trim() }
      : { action: "select" as const, baseId: selectedBaseId ?? "" };
    setBusy(true);
    try {
      const result = await api(`events/${eventId}/airtable/bases`, airtableBaseChoiceResultSchema, {
        method: "POST",
        body,
      });
      onConnection(result.connection);
      setBaseId(result.connection.baseId);
      setBaseName(result.connection.baseName);
      setSchemaReport(result.schema);
      setStep("run");
      if (result.schema.ok) void startFirstSync();
    } catch (caught) {
      if (isDefinitiveWriteFailure(caught)) {
        const message = caught.fieldErrors
          ? Object.values(caught.fieldErrors)[0] ?? caught.message
          : caught.message;
        setFieldError(message);
        toast(message, { kind: "error" });
      } else {
        toast(AIRTABLE_COPY.errors.unknownOutcome, { kind: "error" });
      }
    } finally {
      setBusy(false);
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

  if (!open) return null;

  const verdict = tokenState.kind === "valid" ? tokenState.verdict : null;
  const tokenReady = verdict?.canConnect === true || (entryStep === "base" && connection !== null);
  const canSubmitBase = choice === "create"
    ? newBaseName.trim().length > 0 && workspaceId.trim().length > 0
    : selectedBaseId !== null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!busy && !syncing}
      wide
      title={step === "token" ? AIRTABLE_COPY.token.heading : step === "base" ? AIRTABLE_COPY.base.heading : AIRTABLE_COPY.firstRun.heading}
      {...(step === "token"
        ? { description: AIRTABLE_COPY.token.lead }
        : step === "base"
          ? { description: AIRTABLE_COPY.base.lead }
          : {})}
      footer={<ConnectFooter
        step={step}
        busy={busy}
        syncing={syncing}
        run={run}
        tokenReady={tokenReady}
        canSubmitBase={canSubmitBase}
        baseId={baseId}
        onBack={() => setStep("token")}
        onNext={() => setStep("base")}
        onSubmit={() => void submitBase()}
        onSyncAgain={() => void startFirstSync()}
        onClose={onClose}
      />}
    >
      <p className="airtable-step">{step === "token" ? AIRTABLE_COPY.token.stepLabel : step === "base" ? AIRTABLE_COPY.base.stepLabel : AIRTABLE_COPY.firstRun.stepLabel}</p>

      {step === "token" && (
        <div className="form-stack">
          <Disclosure />
          <Field
            label={AIRTABLE_COPY.token.fieldLabel}
            required
            error={tokenState.kind === "rejected" ? tokenState.message : undefined}
            errorId="airtable-token-error"
          >
            <div className="airtable-token-input">
              <input
                type={showToken ? "text" : "password"}
                value={token}
                autoComplete="off"
                spellCheck={false}
                placeholder={AIRTABLE_COPY.token.placeholder}
                aria-invalid={tokenState.kind === "rejected" ? true : undefined}
                aria-describedby={tokenState.kind === "rejected" ? "airtable-token-error" : "airtable-token-status"}
                onChange={(event) => setToken(event.target.value.trim())}
                autoFocus
              />
              <Button variant="secondary" size="sm" onClick={() => setShowToken((current) => !current)}>
                {showToken ? AIRTABLE_COPY.token.hide : AIRTABLE_COPY.token.show}
              </Button>
            </div>
            <small id="airtable-token-status" role="status">
              <TokenStatusLine state={tokenState} token={token} />
            </small>
          </Field>

          <a className="airtable-token-link" href={AIRTABLE_TOKEN_URL} target="_blank" rel="noopener noreferrer">
            {AIRTABLE_COPY.token.createLink} <ExternalLink size={13} aria-hidden />
          </a>

          {tokenState.kind === "valid" && <ScopeChecklist scopes={tokenState.verdict.scopes} />}
          {tokenState.kind === "valid" && !tokenState.verdict.canConnect && (
            <p className="airtable-note airtable-note--amber" role="status">
              <ShieldAlert size={15} aria-hidden /> {AIRTABLE_COPY.token.blockedByScopes}
            </p>
          )}
        </div>
      )}

      {step === "base" && (
        <div className="form-stack">
          <fieldset className="airtable-choice">
            <legend className="airtable-choice__legend">{AIRTABLE_COPY.base.heading}</legend>
            <label className={choice === "existing" ? "airtable-choice__card is-active" : "airtable-choice__card"}>
              <input
                type="radio"
                name="airtable-base-choice"
                checked={choice === "existing"}
                onChange={() => setChoice("existing")}
              />
              <div>
                <b>{AIRTABLE_COPY.base.useExisting}</b>
                <small>{AIRTABLE_COPY.base.useExistingHint}</small>
              </div>
            </label>
            <label className={choice === "create" ? "airtable-choice__card is-active" : "airtable-choice__card"}>
              <input
                type="radio"
                name="airtable-base-choice"
                checked={choice === "create"}
                disabled={!canManageSchema}
                onChange={() => setChoice("create")}
              />
              <div>
                <b>{AIRTABLE_COPY.base.createNew}</b>
                <small>{canManageSchema ? AIRTABLE_COPY.base.createNewHint : AIRTABLE_COPY.base.createBlocked}</small>
              </div>
            </label>
          </fieldset>

          {choice === "existing" && (
            <div className="airtable-base-list">
              {bases === null && !basesError && <SkeletonText lines={3} label={AIRTABLE_COPY.base.loadingBases} />}
              {/*
                * Clearing the error *is* the retry: the effect above loads
                * whenever there is no list and no error, so calling `loadBases`
                * here too sent two identical requests per click — the direct
                * one, and the one the effect fired the moment `basesError` went
                * back to null. Two is not free on a step whose own copy has a
                * rate-limited branch.
                */}
              {basesError && <LoadFailure message={basesError} onRetry={() => setBasesError(null)} />}
              {bases !== null && bases.length === 0 && !basesError && (
                <p className="airtable-note" role="status">{AIRTABLE_COPY.base.noBases}</p>
              )}
              {bases?.map((base) => (
                <label key={base.id} className={selectedBaseId === base.id ? "airtable-base is-active" : "airtable-base"}>
                  <input
                    type="radio"
                    name="airtable-base"
                    checked={selectedBaseId === base.id}
                    onChange={() => setSelectedBaseId(base.id)}
                  />
                  <div>
                    <b>{base.name}</b>
                    <small>{AIRTABLE_COPY.base.permission(base.permissionLevel)}</small>
                  </div>
                </label>
              ))}
            </div>
          )}

          {choice === "create" && (
            <>
              <Field label={AIRTABLE_COPY.base.baseNameLabel} required>
                <input value={newBaseName} onChange={(event) => setNewBaseName(event.target.value)} maxLength={120} />
              </Field>
              <Field label={AIRTABLE_COPY.base.workspaceLabel} required hint={AIRTABLE_COPY.base.workspaceHint} hintId="airtable-workspace-hint">
                <input
                  value={workspaceId}
                  placeholder={AIRTABLE_COPY.base.workspacePlaceholder}
                  aria-describedby="airtable-workspace-hint"
                  onChange={(event) => setWorkspaceId(event.target.value.trim())}
                />
              </Field>
            </>
          )}

          {fieldError && <p className="field-error" role="alert">{fieldError}</p>}
        </div>
      )}

      {step === "run" && (
        <FirstRunProgress
          run={run}
          syncing={syncing}
          baseName={baseName}
          baseId={baseId}
          schemaReport={schemaReport}
          canManageSchema={canManageSchema}
          onCopyFieldList={() => void copyFieldList()}
        />
      )}

      {step === "token" && scopes.length > 0 && tokenState.kind === "idle" && entryStep === "token" && (
        <p className="airtable-note">{AIRTABLE_COPY.empty.resumeNote}</p>
      )}
    </Modal>
  );
}

function TokenStatusLine({ state, token }: { state: TokenState; token: string }) {
  if (state.kind === "checking") {
    return <span className="airtable-status is-busy"><Loader2 size={13} aria-hidden /> {AIRTABLE_COPY.token.checking}</span>;
  }
  if (state.kind === "valid") {
    const label = state.verdict.accountEmail ?? `usr…${state.verdict.airtableUserId.slice(-4)}`;
    return <span className="airtable-status is-good"><Check size={13} aria-hidden /> {AIRTABLE_COPY.token.connectedTo(label)}</span>;
  }
  if (state.kind === "rejected") return null;
  return <span>{token.trim().length === 0 || !TOKEN_SHAPE.test(token.trim()) ? AIRTABLE_COPY.token.idleHint : AIRTABLE_COPY.token.checking}</span>;
}

function Disclosure() {
  const copy = AIRTABLE_COPY.disclosure;
  return (
    <section className="airtable-disclosure">
      <b>{copy.title}</b>
      <p>
        <b>{copy.pushedLead}</b> {copy.pushedTables} {copy.pushedPeople}
      </p>
      <p>
        <b>{copy.notPushedLead}</b> {copy.notPushedBody}
      </p>
      <p>
        <b>{copy.oneWayLead}</b> {copy.oneWayBody}
      </p>
    </section>
  );
}

/**
 * The live checklist. Each line is driven by the run's per-table counters, so
 * "✓ speakers — 41 records" appears when those 41 records are actually in the
 * customer's base, not when a timer says so.
 */
function FirstRunProgress({
  run,
  syncing,
  baseName,
  baseId,
  schemaReport,
  canManageSchema,
  onCopyFieldList,
}: {
  run: SyncRunSummary | null;
  syncing: boolean;
  baseName: string | null;
  baseId: string | null;
  schemaReport: AirtableSchemaReport | null;
  canManageSchema: boolean;
  onCopyFieldList: () => void;
}) {
  if (schemaReport && !schemaReport.ok) {
    return (
      <div className="form-stack">
        <p className="airtable-note airtable-note--amber" role="status">
          <ShieldAlert size={15} aria-hidden /> {AIRTABLE_COPY.blocked.title}
        </p>
        <p>{canManageSchema ? AIRTABLE_COPY.blocked.withScope : AIRTABLE_COPY.blocked.withoutScope}</p>
        <SchemaIssueList issues={schemaReport.issues} />
        {!canManageSchema && <ManualFieldList />}
        <Button variant="secondary" size="sm" onClick={onCopyFieldList}>{AIRTABLE_COPY.blocked.copyFields}</Button>
      </div>
    );
  }

  const done = run ? statsRecordCount(run.stats) : 0;
  const remaining = run?.stats.deferred ?? 0;
  const total = done + remaining;
  const percent = total === 0 ? (run?.status === "success" ? 100 : 8) : Math.round((done / total) * 100);
  const schemaReady = schemaReport?.ok === true;

  return (
    <div className="form-stack">
      <ProgressBar value={percent} label={AIRTABLE_COPY.firstRun.progressLabel} tone={run?.status === "failed" ? "amber" : "accent"} />
      <ul className="airtable-checklist">
        <li className={schemaReady ? "is-done" : "is-busy"}>
          {schemaReady
            ? AIRTABLE_COPY.firstRun.schemaDone(SYNC_TABLE_ORDER.length)
            : AIRTABLE_COPY.firstRun.schemaPending(baseName ?? "")}
        </li>
        {SYNC_TABLE_CHECKLIST.map((entry) => {
          // A table has a `perTable` entry only once the run has reached it,
          // and a non-zero `deferred` on that entry means the run stopped
          // partway through it. Both are written to the row as they happen, so
          // this line resolves when those records are genuinely in the base.
          const stats = run ? tableStats(run.stats, entry.key) : undefined;
          const complete = stats !== undefined && stats.deferred === 0;
          return (
            <li key={entry.key} className={complete ? "is-done" : "is-busy"}>
              {complete
                ? AIRTABLE_COPY.firstRun.tableDone(entry.label, tableRecordCount(stats))
                : AIRTABLE_COPY.firstRun.tablePending(entry.label)}
            </li>
          );
        })}
      </ul>

      {!syncing && run?.status === "success" && remaining === 0 && (
        <p className="airtable-status is-good"><Check size={14} aria-hidden /> {AIRTABLE_COPY.firstRun.doneTitle}</p>
      )}
      {!syncing && run?.status === "success" && remaining > 0 && (
        <p className="airtable-note airtable-note--amber">{AIRTABLE_COPY.firstRun.deferred(done, remaining)}</p>
      )}
      {!syncing && (run?.status === "failed" || run?.status === "blocked") && (
        <p className="airtable-note airtable-note--amber" role="alert">{run.error ?? AIRTABLE_COPY.firstRun.failed}</p>
      )}
      {baseId && !syncing && (
        <a className="airtable-token-link" href={airtableBaseUrl(baseId)} target="_blank" rel="noopener noreferrer">
          {AIRTABLE_COPY.firstRun.open} <ExternalLink size={13} aria-hidden />
        </a>
      )}
    </div>
  );
}

function ConnectFooter({
  step,
  busy,
  syncing,
  run,
  tokenReady,
  canSubmitBase,
  baseId,
  onBack,
  onNext,
  onSubmit,
  onSyncAgain,
  onClose,
}: {
  step: Step;
  busy: boolean;
  syncing: boolean;
  run: SyncRunSummary | null;
  tokenReady: boolean;
  canSubmitBase: boolean;
  baseId: string | null;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
  onSyncAgain: () => void;
  onClose: () => void;
}) {
  if (step === "token") {
    return <Button onClick={onNext} disabled={!tokenReady}>{AIRTABLE_COPY.token.next}</Button>;
  }
  if (step === "base") {
    return (
      <>
        <Button variant="secondary" onClick={onBack} disabled={busy}>{AIRTABLE_COPY.base.back}</Button>
        <Button onClick={onSubmit} disabled={busy || !canSubmitBase}>
          {busy ? AIRTABLE_COPY.base.submitting : AIRTABLE_COPY.base.submit}
        </Button>
      </>
    );
  }
  const failed = run?.status === "failed" || run?.status === "blocked";
  return (
    <>
      {failed && !syncing && (
        <Button variant="secondary" onClick={onSyncAgain}>{AIRTABLE_COPY.connected.syncNow}</Button>
      )}
      <Button onClick={onClose} disabled={syncing || baseId === null}>
        {syncing ? AIRTABLE_COPY.connected.syncing : AIRTABLE_COPY.firstRun.finish}
      </Button>
    </>
  );
}
