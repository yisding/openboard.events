import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DemoProvider } from "@/shared/demo/demo-provider";
import { DEMO_EVENT_SLUG } from "@/shared/demo/seed";
import { PublicSchedule } from "./public-schedule";

Object.assign(globalThis, { React });

describe("PublicSchedule", () => {
  it("renders schedule content into server markup", () => {
    const html = renderToStaticMarkup(React.createElement(
      DemoProvider,
      null,
      React.createElement(PublicSchedule, { eventSlug: DEMO_EVENT_SLUG, initialSearch: "Agentic" }),
    ));

    expect(html).toContain("Two days of ideas");
    expect(html).toContain("From Prototype to Production: Evaluating Agentic Systems");
    expect(html).not.toContain("The New AI Engineer Stack");
  });
});
