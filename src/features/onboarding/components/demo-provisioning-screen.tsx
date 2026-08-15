"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronRight, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/shared/lib/api-client";
import { Button, ProgressBar } from "@/shared/ui/ui-kit";
import type { OrganizationId } from "@/shared/contracts";
import {
  DEMO_PHASE_COUNT,
  DEMO_PHASE_LABELS,
  DEMO_RUNNABLE_PHASES,
  demoProvisionStateSchema,
  type DemoProvisionStateDTO,
  type DemoRunnablePhase,
} from "../demo-schemas";

/**
 * First Fair (design §2.8) — what the organizer watches while their conference
 * is built.
 *
 * Not a spinner. Ten phases run as ten separate POSTs, and each one that lands
 * writes its own line on the screen, so the narration is a report of what the
 * server actually did rather than a timed animation pretending to be one. The
 * copy comes from `DEMO_PHASE_LABELS`, which the provisioner itself uses — a
 * phase cannot be added without its line, and a line cannot drift away from
 * the phase that earns it.
 *
 * **Never a dead end.** A phase that will not take stops the loop with its own
 * line in amber and two ways forward: run that phase again (it is idempotent,
 * so a retry costs nothing and cannot duplicate a row), or skip to the end and
 * take the world that exists. Both beat an apology and a reload.
 */

/** Ten phases plus the two escape hatches; a loop that cannot terminate is a bug, not a feature. */
const MAX_REQUESTS = DEMO_PHASE_COUNT + 2;

type ScreenPhase = { key: DemoRunnablePhase; label: string; state: "done" | "running" | "failed" };

/**
 * Only the phases that have happened, plus the one happening now. A list of
 * ten pending lines is a spoiler and a wall; the screen fills as the world does.
 */
export function visibleProvisioningPhases(state: DemoProvisionStateDTO | null, failed: boolean): ScreenPhase[] {
  // `ready` is not a runnable phase, so it has no index — which is exactly the
  // signal that every line is behind us.
  const running = DEMO_RUNNABLE_PHASES.indexOf((state?.phase ?? "event") as DemoRunnablePhase);
  if (running < 0) {
    return DEMO_RUNNABLE_PHASES.map((key) => ({ key, label: DEMO_PHASE_LABELS[key], state: "done" }));
  }
  return DEMO_RUNNABLE_PHASES.slice(0, running + 1).map((key, position) => ({
    key,
    label: DEMO_PHASE_LABELS[key],
    state: position < running ? "done" : failed ? "failed" : "running",
  }));
}

export function DemoProvisioningScreen({ organizationId, initialState, onReady }: {
  organizationId: OrganizationId;
  /** The cursor as the server last reported it. `null` before the first POST lands. */
  initialState?: DemoProvisionStateDTO | null;
  /** Overrides the default hand-off, which is a push to the demo's dashboard. */
  onReady?: (state: DemoProvisionStateDTO) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<DemoProvisionStateDTO | null>(initialState ?? null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [skipping, setSkipping] = useState(false);
  const stateRef = useRef<DemoProvisionStateDTO | null>(initialState ?? null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const finish = useCallback((done: DemoProvisionStateDTO) => {
    const handler = onReadyRef.current;
    if (handler) handler(done);
    else router.push(`/events/${done.eventId}/dashboard`);
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      let current = stateRef.current;
      for (let request = 0; request < MAX_REQUESTS && !cancelled; request += 1) {
        if (current?.done) break;
        try {
          current = await api(`organizations/${organizationId}/demo`, demoProvisionStateSchema, {
            method: "POST",
            body: { mode: "provision" },
          });
        } catch {
          // The cursor stays parked on the phase that would not run, so the
          // retry below is a replay of exactly that phase and nothing else.
          if (!cancelled) setFailed(true);
          return;
        }
        if (cancelled) return;
        stateRef.current = current;
        setState(current);
      }
      if (!cancelled && current?.done) finish(current);
    }
    void run();
    return () => { cancelled = true; };
  }, [attempt, finish, organizationId]);

  async function skipPhase() {
    if (skipping) return;
    setSkipping(true);
    try {
      const skipped = await api(`organizations/${organizationId}/demo`, demoProvisionStateSchema, {
        method: "POST",
        body: { mode: "skip" },
      });
      stateRef.current = skipped;
      setState(skipped);
      setFailed(false);
      finish(skipped);
    } catch {
      setSkipping(false);
    }
  }

  const phases = visibleProvisioningPhases(state, failed);
  const completed = state?.done ? DEMO_PHASE_COUNT : Math.max((state?.phaseIndex ?? 1) - 1, 0);
  const percent = Math.round((completed / DEMO_PHASE_COUNT) * 100);

  return (
    <section className="panel" style={{ maxWidth: 620, padding: "24px 24px 26px" }} aria-labelledby="demo-provisioning-title">
      <h2 id="demo-provisioning-title" style={{ margin: 0, fontSize: "var(--text-base)" }}>
        Building AI Engineer World&rsquo;s Fair
      </h2>
      <p style={{ margin: "6px 0 18px", color: "var(--muted)", fontSize: "var(--text-sm)" }}>
        {completed} of {DEMO_PHASE_COUNT} · a real conference, built with the same writers your own event uses.
      </p>
      <ProgressBar value={percent} label="Demo event build progress" tone={failed ? "amber" : "accent"} />

      <ol
        aria-live="polite"
        style={{ display: "grid", gap: 7, margin: "18px 0 0", padding: 0, listStyle: "none" }}
      >
        {phases.map((phase) => (
          <li
            key={phase.key}
            style={{
              display: "grid", gridTemplateColumns: "18px minmax(0, 1fr)", alignItems: "start", gap: 8,
              fontSize: "var(--text-sm)",
              color: phase.state === "failed" ? "var(--amber)" : phase.state === "done" ? "var(--ink)" : "var(--muted)",
            }}
          >
            <span aria-hidden="true" style={{ display: "grid", placeItems: "center", height: 20 }}>
              {phase.state === "done" ? <Check size={14} color="var(--green)" />
                : phase.state === "failed" ? <TriangleAlert size={14} />
                  : <ChevronRight size={14} />}
            </span>
            <span>{phase.state === "done" ? phase.label.replace(/…$/u, "") : phase.label}</span>
          </li>
        ))}
      </ol>

      {failed && <div style={{ marginTop: 18 }}>
        <p style={{ margin: "0 0 10px", color: "var(--muted)", fontSize: "var(--text-sm)", lineHeight: 1.5 }}>
          That step did not take. Running it again is free — it is built to be repeated and cannot duplicate anything.
          You can also carry on without it; the rest of the demo works, and the parts that needed this step will say so.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Button size="sm" disabled={skipping} onClick={() => { setFailed(false); setAttempt((current) => current + 1); }}>
            Try that step again
          </Button>
          <Button size="sm" variant="secondary" disabled={skipping} onClick={() => void skipPhase()}>
            {skipping ? "Continuing…" : "Continue without it"}
          </Button>
        </div>
      </div>}
    </section>
  );
}
