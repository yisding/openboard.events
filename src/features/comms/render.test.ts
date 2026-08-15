import { describe, expect, it } from "vitest";
import type { TemplateVars } from "@/shared/contracts";
import { SAMPLE_VARS } from "./components/sample-vars";
import { renderTemplate, renderTemplateContent, validateTemplateBody } from "./server/render";

const common = {
  event: { name: "AI Engineer", start_date: "September 15, 2026", location: "Fort Mason", timezone: "PDT" },
  speaker: { first_name: "Nadia", last_name: "Lee", email: "nadia@example.com" },
  portal: { magic_link: "https://example.com/portal/event/verify?token=secret" },
  unsubscribe: { url: "https://example.com/portal/event/unsubscribe" },
};

describe("communications template renderer", () => {
  it("shows a recipient-friendly timezone in the schedule preview", () => {
    const rendered = renderTemplate("schedule_assigned", SAMPLE_VARS.schedule_assigned);
    expect(rendered.html).toContain("10:00 AM–10:40 AM PDT");
    expect(rendered.html).not.toContain("America/Los_Angeles");
  });

  it("renders a contact with no surname instead of failing the send permanently", () => {
    // `contacts.last_name` is NOT NULL DEFAULT '', so a contact created from a
    // submission or an invitation normally has none. An empty value used to
    // raise TEMPLATE_VAR_MISSING, which `isTerminalFailure` treats as
    // unretryable — so an organizer who wrote "{{speaker.first_name}}
    // {{speaker.last_name}}" into a template permanently failed the mail for
    // every such speaker.
    const vars = {
      ...common,
      speaker: { first_name: "Nadia", last_name: "", email: "nadia@example.com" },
      submission: { title: "A talk", code: "SESS-7" },
    } as TemplateVars;
    const rendered = renderTemplateContent(
      "submission_received",
      "Received, {{speaker.first_name}} {{speaker.last_name}}",
      "<p>Hi {{speaker.first_name}} {{speaker.last_name}}.</p>",
      vars,
    );
    expect(rendered.subject).toBe("Received, Nadia");
    expect(rendered.html).toContain("Hi Nadia .");
  });

  it("still refuses a variable the context genuinely failed to supply", () => {
    const vars = {
      ...common,
      submission: { title: "", code: "SESS-7" },
    } as TemplateVars;
    expect(() => renderTemplateContent("submission_received", "Received", "<p>{{submission.title}}</p>", vars))
      .toThrowError(/missing variable submission\.title/u);
  });

  it("breaks a line for every block-level closer, not only <br> and </p>", () => {
    // `{{tasks.outstanding_list}}` is a bare `<ul><li>…</li></ul>` and is the
    // entire payload of the default `task_reminder` body. Breaking only on
    // `<br>` and `</p>` left `parseTag` to delete the list tags with no
    // separator, so the text/plain alternative every plain-text reader and
    // every spam filter sees ran the items together:
    // "Upload your headshot — September 1Sign the agreement — September 5".
    const body = "<p>Here are your tasks:</p><ul><li>Upload your headshot</li><li>Sign the agreement</li></ul><h2>Then</h2><blockquote>Reply to us</blockquote>";
    const rendered = renderTemplateContent("task_reminder", "Tasks", body, {
      ...common,
      task: { name: "Upload your headshot", due_date: "September 1", portal_url: "https://example.com/portal" },
      tasks: { outstanding_list: "" },
    } as unknown as TemplateVars);

    expect(rendered.text).toContain("Upload your headshot\nSign the agreement");
    expect(rendered.text).not.toContain("headshotSign");
    // The list/heading boundary yields a blank line, which is what a reader
    // wants; the \n{3,} collapse keeps it to exactly one.
    expect(rendered.text).toContain("Sign the agreement\n\nThen\nReply to us");
    // The HTML part is untouched.
    expect(rendered.html).toContain("<li>Upload your headshot</li>");
  });

  it("carries each link's destination into the plain-text alternative", () => {
    // Stripping tags deletes the href, so the text/plain part used to read
    // "Open your speaker portal" with no address anywhere in it — and the
    // unsubscribe line the layout appends had nowhere to go either.
    const rendered = renderTemplate("submission_received", SAMPLE_VARS.submission_received);
    expect(rendered.html).toContain("<a href=");
    expect(rendered.text).toMatch(/\(https?:\/\//u);
    // The HTML part is untouched.
    expect(rendered.html).not.toContain(" (https://");
  });

  it("does not repeat a URL that is already its own label", () => {
    const vars = { ...common, submission: { title: "A talk", code: "SESS-7" } } as TemplateVars;
    const rendered = renderTemplateContent(
      "submission_received",
      "Received",
      '<p><a href="https://example.com/x">https://example.com/x</a></p>',
      vars,
    );
    expect(rendered.text).toContain("https://example.com/x");
    expect(rendered.text).not.toContain("https://example.com/x (https://example.com/x)");
  });

  it("unescapes an entity once, not twice, on the way to plain text", () => {
    // `&amp;lt;` is the escaped *text* `&lt;`, so the plain-text part should
    // read `&lt;`. Decoding `&amp;` before `&lt;` unescaped it a second time
    // and produced a `<` the author had deliberately escaped — and the same
    // ordering shortened any link whose query string carried an `&amp;amp;`.
    const vars = { ...common, submission: { title: "A talk", code: "SESS-7" } } as TemplateVars;
    const rendered = renderTemplateContent(
      "submission_received",
      "Received",
      '<p>&amp;lt;b&amp;gt; &amp;amp; friends</p><p><a href="https://example.com/x?a=1&amp;amp;b=2">Link</a></p>',
      vars,
    );
    expect(rendered.text).toContain("&lt;b&gt; &amp; friends");
    expect(rendered.text).not.toContain("<b>");
    // The query separator survives as one `&`, and the link is not cut short.
    expect(rendered.text).toContain("https://example.com/x?a=1&b=2");
  });

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
