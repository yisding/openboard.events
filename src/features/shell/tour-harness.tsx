"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { forgetTourMirror, GuidedTourMount, TourAnchor } from "@/shared/ui/app/guided-tour";
import type { TourBootstrap, TourChapter, TourCompletion, TourStateWire, TourStep, TourTransport } from "@/shared/ui/app/guided-tour";
import { Button, PageHeader, StatusBadge } from "@/shared/ui/ui-kit";

/**
 * The guided tour, against a fixture.
 *
 * The engine is domain-free by construction — it takes a script, an anchor
 * ladder and a transport, and knows nothing about events, submissions or demo
 * data. This page is the proof: five steps, one of every objective kind, a
 * pretend world you can move with two buttons, and no server anywhere.
 *
 * It is also where the awkward cases are cheapest to check by hand: the
 * spotlight following a control across a scroll, the coach portalling into a
 * native `<dialog>`, the card degrading to the centre when an anchor never
 * mounts, and the whole thing going still under `prefers-reduced-motion`.
 */

const SCOPE_ID = "kitchen-sink";

const CHAPTERS: readonly TourChapter[] = [
  { id: "basics", name: "The basics" },
  { id: "objectives", name: "Objectives" },
];

const STEPS: readonly TourStep[] = [
  {
    id: "basics.card",
    chapter: "basics",
    kind: "beat",
    title: "This is the coach card.",
    body: "It never traps focus and never blocks what it points at. Escape pauses, and costs nothing.",
    anchor: { kind: "selector", css: ".tour-demo-toolbar" },
    placement: "bottom",
    continueLabel: "Show me the spotlight",
  },
  {
    id: "basics.spotlight",
    chapter: "basics",
    kind: "observe",
    title: "The spotlight has a real hole in it.",
    body: "The whole overlay is pointer-events: none, so the control underneath is still the control. Scroll — it re-measures rather than closing.",
    anchor: { kind: "role", role: "button", name: "A control the tour points at" },
    placement: "right",
  },
  {
    id: "objectives.dom",
    chapter: "objectives",
    kind: "act",
    title: "Open the details panel.",
    body: "This objective watches the DOM for a lazily-mounted target, the way a drawer or a tab panel arrives late.",
    anchor: { kind: "selector", css: ".tour-demo-panel-toggle" },
    placement: "bottom",
    objective: { via: "dom", present: "harness.panel" },
    hint: "The button directly under the spotlight.",
    reward: { emoji: "🔍", line: "Found it — that was a MutationObserver, not a click handler." },
  },
  {
    id: "objectives.world",
    chapter: "objectives",
    kind: "act",
    title: "Ship something.",
    body: "The objective is server truth, not a click: move the counter from anywhere and the step completes.",
    anchor: { kind: "tour-id", id: "harness.ship" },
    placement: "top",
    objective: { via: "world", fact: "shipped", delta: "increased" },
    hint: "Either Ship button works — including the one the tour never mentioned.",
    reward: { emoji: "🚀", line: "The world moved, so the step is done. No click was scripted." },
  },
  {
    id: "quest.self",
    chapter: "objectives",
    kind: "act",
    optional: true,
    title: "Read the docs (a side quest).",
    body: "Some objectives belong to the card itself. This one records the moment you use its own control.",
    anchor: { kind: "none" },
    objective: { via: "self" },
    action: { label: "Open the design system", href: "/kitchen-sink", newTab: true },
    reward: { emoji: "🏆", line: "Side quests live in the tray until you want them." },
  },
];

function freshState(): TourStateWire {
  return {
    chapter: "basics",
    stepId: "basics.card",
    status: "active",
    armedStepId: null,
    armedBaseline: null,
    completed: [],
    questsDone: [],
    world: { shipped: 0 },
  };
}

export function TourHarness() {
  const [generation, setGeneration] = useState(0);
  const [running, setRunning] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [shipped, setShipped] = useState(0);
  const [log, setLog] = useState<readonly string[]>([]);
  const stateRef = useRef<TourStateWire>(freshState());
  const shippedRef = useRef(0);

  const note = useCallback((line: string) => {
    setLog((current) => [`${new Date().toISOString().slice(11, 19)}  ${line}`, ...current].slice(0, 8));
  }, []);

  const transport = useMemo<TourTransport>(() => ({
    read: async () => ({ ...stateRef.current, world: { shipped: shippedRef.current } }),
    patch: async (patch) => {
      stateRef.current = {
        ...stateRef.current,
        chapter: patch.chapter,
        stepId: patch.stepId,
        status: patch.status,
        ...(patch.armedStepId === undefined ? {} : { armedStepId: patch.armedStepId }),
        ...(patch.armedBaseline === undefined ? {} : { armedBaseline: patch.armedBaseline }),
      };
      note(`PATCH cursor → ${patch.stepId} (${patch.status})`);
      return { ...stateRef.current, world: { shipped: shippedRef.current } };
    },
    record: async (stepId, outcome) => {
      note(`POST step → ${stepId} (${outcome})`);
    },
    // `generation` intentionally rebuilds the transport on reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [note, generation]);

  const bootstrap = useMemo<TourBootstrap>(() => ({
    scopeId: SCOPE_ID,
    statePath: "kitchen-sink/tour",
    stepsPath: "kitchen-sink/tour/steps",
    transport,
    chapters: CHAPTERS,
    steps: STEPS,
    cursor: { chapter: "basics", stepId: "basics.card", status: "active" },
    completed: [],
    questsDone: [],
    world: { shipped: shippedRef.current },
    context: { eventId: "fixture" },
  }), [transport]);

  /**
   * Back to the top, fixture and all.
   *
   * Both the Reset button and the end of the tour land here. Winding the
   * fixture back is not tidiness: the mirror still records the finished
   * cursor and the stage still holds whatever satisfied the last objective,
   * so a second run over either would come up already complete.
   */
  const rewind = useCallback(() => {
    // The engine owns the key; a second copy of the prefix here is a silent
    // no-op the day `mirror.ts` changes it.
    forgetTourMirror(SCOPE_ID);
    stateRef.current = freshState();
    shippedRef.current = 0;
    setShipped(0);
    setPanelOpen(false);
    setRunning(false);
    setGeneration((current) => current + 1);
  }, []);

  const reset = useCallback(() => {
    rewind();
    setLog([]);
  }, [rewind]);

  /**
   * The harness has to *watch* the tour end, not assume it never does.
   *
   * Without this, finishing a run left "Start the tour" disabled and labelled
   * "Running" over a tutorial that had visibly stopped — and Reset, which also
   * wipes the transport log the page exists to show, was the only way back.
   */
  const onComplete = useCallback(({ via }: TourCompletion) => {
    note(`tour ${via === "skipped" ? "closed early" : "finished"} — harness rewound`);
    rewind();
  }, [note, rewind]);

  const ship = useCallback(() => {
    shippedRef.current += 1;
    setShipped(shippedRef.current);
  }, []);

  return (
    <main className="page showcase-page">
      <PageHeader
        eyebrow="PLATFORM"
        title="Guided tour"
        description="The tutorial engine against a fixture script: five steps, one of every objective kind, and a pretend world you can move by hand."
        actions={<>
          <Button variant="secondary" onClick={reset}>Reset the tour</Button>
          <Button onClick={() => setRunning(true)} disabled={running}>{running ? "Running" : "Start the tour"}</Button>
        </>}
      />

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">The stage</h2>
        <p>
          Everything below is ordinary UI. The tour points at it from the outside and never wraps it,
          which is the same relationship it has with the admin shell.
        </p>
        <div className="tour-demo-toolbar" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: 12, border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface)" }}>
          <Button variant="secondary" aria-label="A control the tour points at">Spotlight me</Button>
          <Button
            variant="secondary"
            className="tour-demo-panel-toggle"
            onClick={() => setPanelOpen((current) => !current)}
          >
            {panelOpen ? "Close details" : "Open details"}
          </Button>
          <TourAnchor id="harness.ship">
            <Button onClick={ship}>Ship something</Button>
          </TourAnchor>
          <Button variant="ghost" onClick={ship}>Ship it from over here instead</Button>
          <StatusBadge value="demo" />
          <span style={{ color: "var(--muted)", fontSize: "var(--text-xs)" }}>shipped: {shipped}</span>
        </div>
        {panelOpen && (
          <div data-tour="harness.panel" className="tour-demo-panel" style={{ marginTop: 12, padding: 16, border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface-raised)" }}>
            <b>A panel that mounts late</b>
            <p style={{ color: "var(--muted)", fontSize: "var(--text-xs)", margin: "4px 0 0" }}>
              Its <code>data-tour</code> attribute is what the DOM objective watches for. Nothing here
              knows the tour exists.
            </p>
          </div>
        )}
        {/* Room to scroll, so the spotlight can be watched following its anchor. */}
        <div
          aria-hidden
          style={{
            height: 520,
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px dashed var(--line)",
            borderRadius: 12,
            color: "var(--muted)",
            fontSize: "var(--text-xs)",
          }}
        >
          scroll spacer for spotlight testing
        </div>
      </section>

      <section>
        <h2 className="section-title">What the engine sent</h2>
        <p>
          The transport is in memory here; in the product it is one PATCH to the tour cursor and one
          POST to the append-only achievement log.
        </p>
        {log.length === 0
          ? <p style={{ color: "var(--muted)", fontSize: "var(--text-xs)" }}>Nothing yet. Start the tour.</p>
          : <ul style={{ display: "grid", gap: 4, margin: 0, padding: 0, listStyle: "none", fontSize: "var(--text-xs)", color: "var(--muted)" }}>
            {log.map((line) => <li key={line}><code>{line}</code></li>)}
          </ul>}
      </section>

      <GuidedTourMount key={generation} bootstrap={running ? bootstrap : null} onComplete={onComplete} />
    </main>
  );
}
