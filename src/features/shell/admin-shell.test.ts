import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { activeAdminSection, adminMobileNavigationState, shellHintIds } from "./admin-shell";

describe("admin shell route matching", () => {
  const base = "/events/00000000-0000-4000-8000-000000000001";

  it("uses the first event-relative segment on nested task form routes", () => {
    expect(activeAdminSection(`${base}/tasks/forms/00000000-0000-4000-8000-000000000099`, base)).toBe("tasks");
  });

  it("does not activate an event nav item outside the event", () => {
    expect(activeAdminSection("/events", base)).toBeUndefined();
  });
});

describe("first-run hints per role", () => {
  it("welcomes reviewers with their own hints instead of the organizer set", () => {
    const source = readFileSync(new URL("./admin-shell.tsx", import.meta.url), "utf8");

    expect(source).toContain("ids={hintIds}");
    expect(source).toContain('id="shell:review-queue"');
    expect(source).toContain('id={role === "reviewer" ? "shell:reviewer-palette" : "shell:command-palette"}');

    expect(shellHintIds("organizer", false)).toContain("shell:event-switcher");
    expect(shellHintIds("reviewer", false)).toEqual(["shell:review-queue", "shell:reviewer-palette"]);
  });

  it("goes quiet while the guided tour is running, and comes back when it pauses", () => {
    // First Fair (design §3.9). One onboarding voice at a time — and the mute
    // is an empty id list, so it writes nothing and undoes itself.
    expect(shellHintIds("organizer", true)).toEqual([]);
    expect(shellHintIds("organizer", false)).toHaveLength(5);
    // A reviewer never has a tour to be interrupted by, so their beacons stand.
    expect(shellHintIds("reviewer", true)).toHaveLength(2);
  });
});

describe("the guided tour's mount point", () => {
  const source = readFileSync(new URL("./admin-shell.tsx", import.meta.url), "utf8");

  it("mounts inside the unsaved-work guard, and only when the route supplies a tour", () => {
    // First Fair (design §3.1). The ordering is mandatory: the tour navigates
    // through `useGuardedAction()`, whose context is null above the provider,
    // and the mount is conditional so a real-event organizer never downloads
    // the engine at all.
    expect(source).toContain("return <UnsavedWorkGuardProvider>");
    // `onStatusChange` is not decoration: the shell's own copy of the status
    // came from a server render, and a soft navigation reuses it for the life
    // of the session — so without the callback the palette keeps offering only
    // "Restart the guided tour" after a pause. The cursor rides along with it
    // because a Resume that names the chapter of the last full page load is
    // an offer to throw away everything since.
    expect(source).toContain("{activeTour && <GuidedTourMount bootstrap={activeTour} onComplete={retireShellHints} onStatusChange={handleTourStatusChange} />}");
    expect(source).toContain("setLiveTourCursor({ chapter: cursor.chapter, stepId: cursor.stepId });");
    // Resume carries no step of its own: only the row knows where the player
    // actually stopped.
    expect(source).toContain('run: () => moveTourCursor("server", currentHref),');
    expect(source).toContain("const GuidedTourMount = dynamic(");
    expect(source).toContain("{ ssr: false }");
  });

  it("keeps the tour a sibling of the shell, never its parent", () => {
    // `ssr: false` renders nothing on the server, children included. A shell
    // handed to the mount as children would stop server-rendering on demo
    // events — a blank admin page until hydration.
    expect(source).toContain("{shell}\n    {activeTour &&");
    expect(source).not.toContain("<GuidedTourMount bootstrap={activeTour} onComplete={retireShellHints}>");
  });

  it("keeps the shell's import graph at shell -> shared", () => {
    // D8. The engine is generic UI in `shared/ui`; the script is domain data
    // the *route module* reads. An import of the onboarding feature here would
    // put tutorial copy in every organizer's bundle and a new edge in a graph
    // whose baseline is empty.
    expect(source).not.toContain("@/features/onboarding");
  });

  it("never offers a tutorial to a reviewer", () => {
    expect(source).toContain('const activeTour = role === "reviewer" ? undefined : tour;');
  });

  it("links the public preview at the agenda, not the redirect-only legacy route", () => {
    expect(source).toContain("href={`/e/${event.slug}/agenda`}");
    expect(source).not.toContain("/e/${event.slug}/schedule");
  });
});

describe("the shell's mobile breakpoint and the stylesheet's", () => {
  // These two numbers describe one layout. While they disagreed — 860 here,
  // 768 in the stylesheet — every width between them rendered the desktop
  // sidebar and then marked it inert, with no hamburger to reopen it.
  it("marks the sidebar inert at exactly the width the stylesheet takes it off-canvas", () => {
    const source = readFileSync(new URL("./admin-shell.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    const query = source.match(/const MOBILE_SHELL_QUERY = "\(max-width: (\d+)px\)"/u);
    expect(query, "admin-shell.tsx should declare MOBILE_SHELL_QUERY").not.toBeNull();
    expect(source).toContain("window.matchMedia(MOBILE_SHELL_QUERY)");

    // The stylesheet block that actually takes the sidebar off-canvas: the last
    // max-width media query opened before the translateX rule that hides it.
    const hidden = css.indexOf("translateX(-102%)");
    expect(hidden, "globals.css should take .admin-sidebar off-canvas").toBeGreaterThan(-1);
    const breakpoints = [...css.slice(0, hidden).matchAll(/@media\s*\(\s*max-width:\s*(\d+)px\s*\)/gu)];
    const offCanvasWidth = breakpoints.at(-1)?.[1];

    expect(offCanvasWidth, "the off-canvas rule should sit inside a max-width block").toBeDefined();
    expect(query?.[1]).toBe(offCanvasWidth);
  });
});

describe("admin mobile navigation accessibility state", () => {
  it("removes the closed off-canvas sidebar from navigation", () => {
    expect(adminMobileNavigationState(true, false)).toEqual({ sidebarHidden: true, backgroundInert: false });
  });

  it("makes the background inert only while the mobile sidebar is open", () => {
    expect(adminMobileNavigationState(true, true)).toEqual({ sidebarHidden: false, backgroundInert: true });
    expect(adminMobileNavigationState(false, false)).toEqual({ sidebarHidden: false, backgroundInert: false });
  });
});
