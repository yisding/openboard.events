import { describe, expect, it } from "vitest";
import { autoResizeEmbedSnippet, fixedHeightEmbedSnippet } from "./embed-snippets";

const options = {
  origin: "https://events.example",
  eventSlug: "openboard-live",
  route: "agenda",
  title: 'Openboard Live — Agenda & "Sessions"',
};

describe("embed install snippets", () => {
  it("makes the recommended loader self-describing and safe to paste into HTML", () => {
    expect(autoResizeEmbedSnippet(options)).toBe(
      '<script src="https://events.example/embed.js" data-event="openboard-live" data-type="agenda" data-title="Openboard Live — Agenda &amp; &quot;Sessions&quot;" async></script>',
    );
  });

  it("keeps a script-free iframe fallback with an accessible title and no inline baseline gap", () => {
    expect(fixedHeightEmbedSnippet(options)).toBe(
      '<iframe src="https://events.example/embed/openboard-live/agenda" width="100%" height="760" style="border:0;display:block" loading="lazy" title="Openboard Live — Agenda &amp; &quot;Sessions&quot;"></iframe>',
    );
  });

  it("encodes path components rather than letting hand-authored values change the route", () => {
    expect(fixedHeightEmbedSnippet({ ...options, eventSlug: "one/two", route: "agenda?theme=dark" }))
      .toContain('/embed/one%2Ftwo/agenda%3Ftheme%3Ddark');
  });
});
