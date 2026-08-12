import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import VerifiedEmailPage from "./page";

Object.assign(globalThis, { React });

describe("verified signup handoff", () => {
  it("presents one unambiguous sign-in action after confirmation", async () => {
    const html = renderToStaticMarkup(await VerifiedEmailPage({
      searchParams: Promise.resolve({ confirmed: "1", next: "/organizations" }),
    }));

    expect(html.match(/Continue to sign in/g)).toHaveLength(1);
    expect(html).not.toContain("Back to sign in");
  });

  it("keeps a sign-in escape hatch beside expired-link recovery", async () => {
    const html = renderToStaticMarkup(await VerifiedEmailPage({
      searchParams: Promise.resolve({ error: "expired" }),
    }));

    expect(html).toContain("That link did not work");
    expect(html.match(/Back to sign in/g)).toHaveLength(1);
  });
});
