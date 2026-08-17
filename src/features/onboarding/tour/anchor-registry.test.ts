import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { TourAnchorSpec } from "@/shared/ui/app/guided-tour";
import { DIALOG_BOUND_ANCHORS, TOUR_ANCHOR_IDS } from "./anchors";
import { TOUR_STEPS } from "./script";

/**
 * The anchor contract.
 *
 * A tour points at other people's UI, which makes it the most rot-prone thing
 * in the repo: a rename three features away silently turns a spotlight into a
 * card floating over nothing. This test parses the tree and fails
 * `pnpm check` **naming the step that will break**, which is the difference
 * between a five-minute fix and a bug report from an organizer.
 *
 * Runtime behaviour is still forgiving — an anchor that never mounts degrades
 * to a centred card with the same copy and the same objective, never a crash.
 * This test exists so that degradation is a safety net rather than a plan.
 */

const SRC = fileURLToPath(new URL("../../..", import.meta.url));
const APP_EVENT_ROUTES = join(SRC, "app", "events", "[eventId]");

function sourceFiles(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (!/\.tsx?$/u.test(entry)) continue;
    // Fixtures mount whatever they like; only shipped UI is a contract. The
    // `/kitchen-sink` harness drives the engine with a throwaway script and is
    // the same kind of fixture, so its ids are not registry entries either.
    if (/\.test\.tsx?$/u.test(entry)) continue;
    if (path.includes("kitchen-sink") || entry === "tour-harness.tsx") continue;
    found.push(path);
  }
  return found;
}

const SHIPPED = sourceFiles(SRC).map((path) => ({ path: path.slice(SRC.length), text: readFileSync(path, "utf8") }));
const ALL_SOURCE = SHIPPED.map((file) => file.text).join("\n");
const GLOBALS = readFileSync(join(SRC, "app", "globals.css"), "utf8");

/** Both the JSX attribute form and the conditional-spread form the codebase uses. */
const TOUR_ATTRIBUTE = /(?:data-tour="([^"]+)"|"data-tour"\s*:\s*"([^"]+)")/gu;
const TOUR_ANCHOR_ELEMENT = /<TourAnchor\s+id="([^"]+)"/gu;

function declaredAnchors(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of SHIPPED) {
    for (const match of file.text.matchAll(TOUR_ATTRIBUTE)) {
      const id = match[1] ?? match[2];
      if (id) found.set(id, [...(found.get(id) ?? []), file.path]);
    }
    for (const match of file.text.matchAll(TOUR_ANCHOR_ELEMENT)) {
      const id = match[1];
      if (id) found.set(id, [...(found.get(id) ?? []), file.path]);
    }
  }
  return found;
}

const DECLARED = declaredAnchors();

function anchorsOfKind<K extends TourAnchorSpec["kind"]>(kind: K): Array<{ stepId: string; anchor: Extract<TourAnchorSpec, { kind: K }> }> {
  const found: Array<{ stepId: string; anchor: Extract<TourAnchorSpec, { kind: K }> }> = [];
  for (const step of TOUR_STEPS) {
    if (step.anchor?.kind === kind) found.push({ stepId: step.id, anchor: step.anchor as Extract<TourAnchorSpec, { kind: K }> });
  }
  return found;
}

/** `/events/:eventId/forms/:cfpFormId/preview` -> the directory that renders it. */
function routeDirectory(path: string): string | null {
  const prefix = "/events/:eventId";
  if (!path.startsWith(prefix)) return null;
  let directory = APP_EVENT_ROUTES;
  for (const segment of path.slice(prefix.length).split("/").filter(Boolean)) {
    if (!existsSync(directory)) return null;
    const entries = readdirSync(directory).filter((entry) => statSync(join(directory, entry)).isDirectory());
    const match = segment.startsWith(":")
      ? entries.find((entry) => entry.startsWith("[") && entry.endsWith("]"))
      : entries.find((entry) => entry === segment);
    if (!match) return null;
    directory = join(directory, match);
  }
  return directory;
}

describe("guided tour anchor registry", () => {
  it("declares every pinned attribute exactly once, in shipped UI", () => {
    for (const id of TOUR_ANCHOR_IDS) {
      const owners = DECLARED.get(id) ?? [];
      expect(owners, `${id} is in the registry but nothing renders it`).toHaveLength(1);
    }
  });

  it("leaves no data-tour attribute behind", () => {
    // An orphan is worse than a missing one: it reads like a live contract and
    // is not, so the next refactor keeps it alive for no reason.
    const referenced = new Set(
      TOUR_STEPS.flatMap((step) => (step.anchor?.kind === "tour-id" ? [step.anchor.id] : []))
        .concat(TOUR_STEPS.flatMap((step) => (step.objective?.via === "dom" ? [step.objective.present] : []))),
    );
    for (const id of DECLARED.keys()) {
      expect(TOUR_ANCHOR_IDS as readonly string[], `${id} is rendered but not in the registry`).toContain(id);
      expect([...referenced], `${id} is rendered but no step points at it`).toContain(id);
    }
    for (const id of TOUR_ANCHOR_IDS) {
      expect([...referenced], `${id} is in the registry but no step points at it`).toContain(id);
    }
  });

  it("verifies every dom objective against a pinned attribute", () => {
    // `tourIdPresent` only ever looks at `data-tour`, so a `via: "dom"`
    // objective naming anything else can never be satisfied.
    for (const step of TOUR_STEPS) {
      if (step.objective?.via !== "dom") continue;
      expect(TOUR_ANCHOR_IDS as readonly string[], step.id).toContain(step.objective.present);
    }
  });

  it("resolves every selector anchor against the stylesheet or a className", () => {
    for (const { stepId, anchor } of anchorsOfKind("selector")) {
      const [head, ...rest] = anchor.css.split(/\s+/);
      expect(rest, `${stepId}: keep anchors to a single selector so re-anchoring stays cheap`).toHaveLength(0);
      const selector = head ?? "";
      if (selector.startsWith("#")) {
        expect(ALL_SOURCE, `${stepId}: no element carries id ${selector}`).toContain(selector.slice(1));
        continue;
      }
      const className = selector.replace(/^\./u, "");
      const inStylesheet = GLOBALS.includes(`.${className}`);
      const inMarkup = new RegExp(`className=[^\\n]*\\b${className}\\b`, "u").test(ALL_SOURCE);
      expect(inStylesheet || inMarkup, `${stepId}: nothing renders ${selector}`).toBe(true);
    }
  });

  it("resolves every role anchor against a name the tree actually uses", () => {
    // Two shapes count, because `resolveAnchorElement` accepts both: an
    // `aria-label` (a quoted literal, usually one an accessibility test has
    // already frozen) and a control named by its own visible text.
    for (const { stepId, anchor } of anchorsOfKind("role")) {
      const labelled = ALL_SOURCE.includes(`"${anchor.name}"`);
      const visibleText = ALL_SOURCE.includes(`> ${anchor.name}`) || ALL_SOURCE.includes(`>${anchor.name}<`);
      expect(labelled || visibleText, `${stepId}: nothing is named "${anchor.name}"`).toBe(true);
    }
  });

  it("routes only to admin pages that exist", () => {
    for (const step of TOUR_STEPS) {
      for (const route of [step.route, step.objective?.via === "route" ? step.objective : null]) {
        if (!route) continue;
        const directory = routeDirectory(route.path);
        expect(directory, `${step.id}: ${route.path} has no route module`).not.toBeNull();
        expect(existsSync(join(directory ?? "", "page.tsx")), `${step.id}: ${route.path}`).toBe(true);
      }
    }
  });

  it("keeps the dialog-bound list honest", () => {
    // Each entry claims "this renders inside a native <dialog>". The claim is
    // cheap to check: the file that renders it has to open one.
    for (const selector of DIALOG_BOUND_ANCHORS) {
      const className = selector.replace(/^\./u, "");
      const owners = SHIPPED.filter((file) => new RegExp(`className=[^\\n]*\\b${className}\\b`, "u").test(file.text));
      expect(owners.length, `${selector} is listed as dialog-bound but nothing renders it`).toBeGreaterThan(0);
      const opensDialog = owners.some((file) => /<(ConfirmDialog|Modal|Drawer)\b/u.test(file.text));
      expect(opensDialog, `${selector} is listed as dialog-bound but no owner opens a dialog`).toBe(true);
    }
  });

  it("emits tour signals only from the success handlers that earn them", () => {
    // Latency shortcuts, not authorities: `poll-only.test.tsx` proves the tour
    // completes with none of them. Ten call sites would be a coupling; three,
    // each beside an existing toast, is a courtesy.
    //
    // Each one is the *only* thing that can notice its objective quickly: the
    // work is finished by a save in place, with no navigation and no dialog
    // close behind it, so the poll — stretched towards its ten-second ceiling
    // by the time the organizer has finished typing — is otherwise the whole
    // story. The builder's save is one function every builder action funnels
    // through, which is why the form feature adds one emit and not six.
    const emitters = SHIPPED.filter(
      (file) => file.text.includes("emitTourSignal(") && !file.path.startsWith("shared/ui/app/guided-tour/"),
    );
    expect(emitters.map((file) => file.path).sort()).toEqual([
      "features/agenda/components/session-form-dialog.tsx",
      "features/forms/form-builder.tsx",
      "features/submissions/components/decision-bar.tsx",
    ]);
  });
});
