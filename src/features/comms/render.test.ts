import { describe, expect, it } from "vitest";
import type { TemplateVars } from "@/shared/contracts";
import { renderTemplate, renderTemplateContent, validateTemplateBody } from "./server/render";

const common = {
  event: { name: "AI Engineer", start_date: "September 15, 2026 PDT", location: "Fort Mason", timezone: "America/Los_Angeles" },
  speaker: { first_name: "Nadia", last_name: "Lee", email: "nadia@example.com" },
  portal: { magic_link: "https://example.com/portal/event/verify?token=secret" },
  unsubscribe: { url: "https://example.com/portal/event/unsubscribe" },
};

describe("communications template renderer", () => {
  it("escapes hostile values in the subject and body", () => {
    const vars = { ...common, submission: { title: ";lkj<img onerror=alert(1)>", code: "SESS-7" } } as TemplateVars;
    const rendered = renderTemplate("submission_received", vars);
    expect(rendered.subject).toContain(";lkj<img onerror=alert(1)>");
    expect(rendered.html).toContain(";lkj&lt;img onerror=alert(1)&gt;");
    expect(rendered.html).not.toContain("<img onerror");
  });

  it("fails loudly for null, empty, or object-valued leaves", () => {
    const vars = { ...common, submission: { title: null, code: "SESS-7" } } as unknown as TemplateVars;
    expect(() => renderTemplateContent("submission_received", "Received", "<p>{{submission.title}}</p>", vars)).toThrowError(/missing variable submission\.title/u);
    expect(() => renderTemplateContent("submission_received", "Received", "<p>{{submission}}</p>", { ...common, submission: { title: "A", code: "SESS-7" } } as TemplateVars)).toThrowError(/unknown template variable submission/u);
  });

  it("reports unknown subject and body tokens", () => {
    expect(validateTemplateBody("submission_received", "Hi {{speaker.nickname}}", "{{submission.title}} {{unknown.value}}")).toEqual({
      ok: false,
      unknownTokens: ["speaker.nickname", "unknown.value"],
    });
  });

  it("allows only platform-built HTML fragments through unescaped", () => {
    const vars = {
      ...common,
      task: { name: "Upload slides", due_date: "September 1, 2026 PDT" },
      tasks: { outstanding_list: "<ul><li>Upload slides</li></ul>" },
    } as TemplateVars;
    const rendered = renderTemplate("task_reminder", vars);
    expect(rendered.html).toContain("<ul><li>Upload slides</li></ul>");
  });

  // P3-EMAIL: `isTransactionalTemplate` decides both the fleet-wide unsubscribe
  // skip (dispatcher.test.ts, PGlite) and this footer link — covered here as a
  // pure render test since the layout wrapper needs no database.
  it("shows the footer unsubscribe link only for non-essential templates, and the CAN-SPAM address on both", () => {
    const vars = {
      ...common,
      task: { name: "Upload slides", due_date: "September 1, 2026 PDT" },
      tasks: { outstanding_list: "<ul></ul>" },
    } as TemplateVars;
    const layoutMeta = { unsubscribeUrl: "https://example.com/portal/event/unsubscribe?token=abc", physicalAddress: "123 Main St, San Francisco, CA" };

    const nonEssential = renderTemplateContent("task_assigned", "New task", "<p>{{task.name}}</p>", vars, layoutMeta);
    expect(nonEssential.html).toContain("https://example.com/portal/event/unsubscribe?token=abc");
    expect(nonEssential.html).toContain("123 Main St, San Francisco, CA");

    const decisionVars = { ...common, submission: { title: "A talk", code: "SESS-1" } } as TemplateVars;
    const essential = renderTemplateContent("submission_accepted", "Accepted", "<p>{{submission.title}}</p>", decisionVars, layoutMeta);
    expect(essential.html).not.toContain("unsubscribe?token=abc");
    expect(essential.html).toContain("123 Main St, San Francisco, CA");
  });
});
