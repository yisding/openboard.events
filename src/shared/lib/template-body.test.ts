import { describe, expect, it } from "vitest";
import { sanitize } from "./sanitize";
import { sanitizeTemplateBody } from "./template-body";

/**
 * Every stored template body is re-rendered at send time, so whatever the
 * sanitizer discards on save is discarded for every recipient. The shared
 * allowlist drops any href that is not http(s)/mailto — which is every merge
 * token — so a template body sanitized with `sanitize()` reaches speakers as
 * link-less text.
 */
describe("sanitizeTemplateBody", () => {
  const link = '<p><a href="{{portal.magic_link}}">Open your speaker portal</a></p>';

  it("keeps a supported merge token as an entire href", () => {
    expect(sanitizeTemplateBody(link)).toContain('href="{{portal.magic_link}}"');
    // The failure it exists to prevent, stated as a contrast.
    expect(sanitize(link)).not.toContain("href");
  });

  it("keeps every URL-valued token the templates ship with", () => {
    for (const token of ["unsubscribe.url", "calendar.download_url", "review.queue_url", "invite.action_url"]) {
      expect(sanitizeTemplateBody(`<a href="{{${token}}}">go</a>`)).toContain(`href="{{${token}}}"`);
    }
  });

  it("still drops an unsupported token and a dangerous protocol", () => {
    expect(sanitizeTemplateBody('<a href="{{submission.title}}">no</a>')).not.toContain("href");
    expect(sanitizeTemplateBody('<a href="javascript:alert(1)">no</a>')).not.toContain("javascript:");
  });
});
