import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { eventIdSchema, organizationIdSchema } from "@/shared/contracts";
import { CrmNav } from "./crm/components/crm-nav";
import { DashboardTabNav } from "./dashboard/components/DashboardTabs";

Object.assign(globalThis, { React });

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function parse(path: string): ts.SourceFile {
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function elements(source: ts.SourceFile, tag: string): Opening[] {
  const found: Opening[] = [];
  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === tag) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

function attribute(source: ts.SourceFile, node: Opening, name: string): ts.JsxAttribute | undefined {
  return node.attributes.properties.find((property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText(source) === name);
}

describe("organizer navigation selected state", () => {
  it("parses named, pressed in-place settings, form, and task filter groups", () => {
    const settings = parse("./events/components/settings-shell.tsx");
    const forms = parse("./forms/forms-page.tsx");
    const tasks = parse("./portal/tasks-admin/components/tasks-admin-view.tsx");

    const settingsNav = elements(settings, "nav").find((node) => attribute(settings, node, "className")?.getText(settings).includes("settings-nav"));
    expect(settingsNav && attribute(settings, settingsNav, "aria-label")).toBeDefined();
    expect(elements(settings, "button").filter((node) => attribute(settings, node, "aria-pressed"))).toHaveLength(1);

    const formGroup = elements(forms, "div").find((node) => attribute(forms, node, "aria-label")?.getText(forms).includes("Form filters"));
    expect(formGroup && attribute(forms, formGroup, "role")?.initializer?.getText(forms)).toBe('"group"');
    // One mapped filter button syntax node renders four filters, alongside the
    // two submission-kind buttons.
    expect(elements(forms, "button").filter((node) => attribute(forms, node, "aria-pressed"))).toHaveLength(3);

    const taskNav = elements(tasks, "nav").find((node) => attribute(tasks, node, "aria-label")?.getText(tasks).includes("Task filters"));
    expect(taskNav).toBeDefined();
    expect(elements(tasks, "button").filter((node) => attribute(tasks, node, "aria-pressed"))).toHaveLength(4);
  });

  it("exposes every audited choice, chip, day, and template selection", () => {
    const expectations = [
      ["./forms/form-builder.tsx", 3],
      ["./portal/form-builder/components/portal-forms-page.tsx", 2],
      ["./portal/form-builder/components/portal-form-builder.tsx", 1],
      ["./portal/tasks-admin/components/file-requests-view.tsx", 1],
      ["./agenda/components/agenda-toolbar.tsx", 2],
      ["./comms/components/templates-tab.tsx", 1],
    ] as const;

    for (const [path, minimum] of expectations) {
      const file = parse(path);
      expect(elements(file, "button").filter((node) => attribute(file, node, "aria-pressed")).length, path).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("renders aria-current only for the exact CRM destination", () => {
    const organizationId = organizationIdSchema.parse("00000000-0000-4000-8000-000000000001");
    const directory = renderToStaticMarkup(React.createElement(CrmNav, { organizationId, active: "directory" }));
    const contact = renderToStaticMarkup(React.createElement(CrmNav, { organizationId, active: "contact" }));
    const pipeline = renderToStaticMarkup(React.createElement(CrmNav, { organizationId, active: "pipeline" }));
    const segments = renderToStaticMarkup(React.createElement(CrmNav, { organizationId, active: "segments" }));

    expect(directory.match(/aria-current="page"/g)).toHaveLength(1);
    expect(contact).not.toContain("aria-current");
    expect(pipeline.match(/aria-current="page"/g)).toHaveLength(1);
    expect(segments.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("renders exactly one correct current dashboard destination for either tab", () => {
    const eventId = eventIdSchema.parse("00000000-0000-4000-8000-000000000002");
    for (const active of ["today", "speakers"] as const) {
      const html = renderToStaticMarkup(React.createElement(DashboardTabNav, { eventId, active }));
      const currentLinks = html.match(/<a(?=[^>]*aria-current="page")[^>]*>/g) ?? [];
      expect(currentLinks).toHaveLength(1);
      expect(currentLinks[0]).toContain(`tab=${active}`);
    }
  });
});
