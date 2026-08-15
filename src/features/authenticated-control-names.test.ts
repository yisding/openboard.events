import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function parse(path: string): ts.SourceFile {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function openings(source: ts.SourceFile, tag: string): Opening[] {
  const found: Opening[] = [];
  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === tag) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

function attribute(source: ts.SourceFile, opening: Opening, name: string): string | undefined {
  const match = opening.attributes.properties.find((property): property is ts.JsxAttribute => (
    ts.isJsxAttribute(property) && property.name.getText(source) === name
  ));
  return match?.initializer?.getText(source);
}

describe("authenticated control names", () => {
  it("names table searches independently of their placeholder text", () => {
    const expectations = [
      ["./comms/components/comms-log-table.tsx", '"Search recipients"'],
      ["./comms/components/suppressions-tab.tsx", '"Search suppressed addresses"'],
      ["./crm/components/contact-detail-view.tsx", '"Search the directory"'],
      ["./crm/components/pipeline-board.tsx", '"Search the directory"'],
      ["./portal/deliverables/components/files-admin-view.tsx", '"Search deliverables"'],
      ["./portal/tasks-admin/components/tasks-admin-view.tsx", '"Search tasks"'],
    ] as const;

    for (const [path, label] of expectations) {
      const source = parse(path);
      expect(openings(source, "input").some((node) => attribute(source, node, "aria-label") === label), path).toBe(true);
    }
  });

  it("names vocabulary creation and CSV file inputs", () => {
    const vocab = parse("./events/components/vocab-tab.tsx");
    expect(openings(vocab, "input").some((node) => attribute(vocab, node, "aria-label") === '{`New ${copy.title.toLowerCase().slice(0, -1)} name`}')).toBe(true);

    for (const path of ["./crm/components/crm-import-dialog.tsx", "./portal/components/speakers-admin/speaker-import-dialog.tsx"]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source, path).toContain('<Field label="CSV file" required>');
      expect(source, path).toContain('accept=".csv,text/csv" required');
    }
  });

  it("names context-dependent selects and comment composers", () => {
    const controls = [
      ["./crm/components/contact-detail-view.tsx", "Select", '"Destination event"'],
      ["./organizations/components/team-panel.tsx", "Select", "{`Role for ${row.original.name || row.original.email}`}"],
      ["./portal/deliverables/components/files-admin-view.tsx", "textarea", '"Reply to the speaker"'],
      ["./portal/task-runtime/components/task-detail.tsx", "textarea", '"Comment for organizers"'],
    ] as const;

    for (const [path, tag, label] of controls) {
      const source = parse(path);
      expect(openings(source, tag).some((node) => attribute(source, node, "aria-label") === label), path).toBe(true);
    }
  });

  it("names the guided tour's icon-only and quiet controls", () => {
    // First Fair (design §8.7). The coach card and its pill are the only
    // chrome the tutorial adds, and three of their controls are an icon or a
    // few words of lowercase text — precisely the shape that ends up as an
    // unnamed button. These strings are also the tour's exit routes, so a
    // keyboard or screen-reader user who wants out has to be able to find
    // them by name.
    const coach = parse("../shared/ui/app/guided-tour/coach.tsx");
    for (const label of ['"Pause the tour"', '"Resume the tour"', '"Hide the tour pill"']) {
      expect(openings(coach, "button").some((node) => attribute(coach, node, "aria-label") === label), label).toBe(true);
    }

    // The two quiet text controls are named by their own content, so they are
    // pinned as literals rather than as labels.
    const coachSource = readFileSync(new URL("../shared/ui/app/guided-tour/coach.tsx", import.meta.url), "utf8");
    expect(coachSource).toContain(">Show me how</button>");
    expect(coachSource).toContain(">Skip this</button>");
    expect(coachSource).toContain(">Finish the tour for good</button>");
  });

  it("names icon-only form-builder back links", () => {
    const links = [
      ["./forms/form-builder.tsx", '"Back to forms"'],
      ["./portal/form-builder/components/portal-form-builder.tsx", '"Back to portal forms"'],
    ] as const;

    for (const [path, label] of links) {
      const source = parse(path);
      expect(openings(source, "Link").some((node) => attribute(source, node, "aria-label") === label), path).toBe(true);
    }
  });
});
