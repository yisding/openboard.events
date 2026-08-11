import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuilderForm } from "./builder-types";
import { ParticipantRoles, withRequiredSpeakerRole } from "./form-builder";

Object.assign(globalThis, { React });

describe("form builder accessibility", () => {
  it("renders Speaker as fixed and required while secondary roles remain named switches", () => {
    const form = {
      participantRoles: [
        { role: "speaker", enabled: false },
        { role: "co_speaker", enabled: true },
        { role: "moderator", enabled: false },
      ],
    } as BuilderForm;
    const html = renderToStaticMarkup(React.createElement(ParticipantRoles, { form, onChange: () => undefined }));

    expect(html).toContain("The primary speaker is always required.");
    expect(html).not.toContain('aria-label="Allow speaker role"');
    expect(html.match(/role="switch"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Allow co-speaker role"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="Allow moderator role"');
    expect(html).toContain('aria-checked="false"');
  });

  it("normalizes stale Speaker data to enabled before saving role changes", () => {
    expect(withRequiredSpeakerRole([
      { role: "speaker", enabled: false },
      { role: "co_speaker", enabled: false },
    ])).toEqual([
      { role: "speaker", enabled: true },
      { role: "co_speaker", enabled: false },
    ]);
  });

  it("keeps the inspector open unless confirmed deletion succeeds", () => {
    const source = readFileSync(new URL("./form-builder.tsx", import.meta.url), "utf8");
    expect(source).toContain("<ConfirmDialog");
    expect(source).toContain('title={pendingDelete ? `Delete “${pendingDelete.label}”?`');
    expect(source).toContain("if (deleted) {");
    expect(source).toContain("setSelected(null);");
    expect(source).toContain("setPendingDelete(null);");
  });
});
