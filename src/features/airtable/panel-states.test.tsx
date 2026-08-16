import * as React from "react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    refresh: () => undefined,
    back: () => undefined,
    forward: () => undefined,
    prefetch: () => undefined,
  }),
  usePathname: () => "/events/e/settings/airtable",
  useSearchParams: () => new URLSearchParams(),
}));

const { ToastProvider } = await import("@/shared/ui/toast");
const { AirtableSettingsPanel } = await import("./index.client");
const { ConnectDialog } = await import("./components/ConnectDialog");
const { emptySyncRunStats } = await import("./schemas");
// The exported types, not `schema["_output"]`: `_output` is a Zod internal that
// happens to be reachable, and it stops carrying the doc comments the summary
// types have on their fields.
type AirtableConnectionSummary = import("./schemas").AirtableConnectionSummary;
type SyncRunSummary = import("./schemas").SyncRunSummary;

const eventId = "6f1f0e2a-1f7e-4a2f-9f1e-2c3d4e5f6a7b" as never;

function connectionFixture(
  overrides: Partial<AirtableConnectionSummary> = {},
): AirtableConnectionSummary {
  return {
    id: "aaaaaaa1-1f7e-4a2f-9f1e-2c3d4e5f6a7b" as never,
    status: "connected",
    airtableUserId: "usrABCD1234EF7f2c",
    accountEmail: null,
    tokenHint: "7f2c",
    scopes: ["data.records:read", "data.records:write", "schema.bases:read", "schema.bases:write"],
    baseId: "appABCD12345678",
    baseName: "SH-5 2026 Program",
    syncEnabled: true,
    options: { includeEmail: true, includeBio: true, includePronouns: false, includeGender: false, pruneRemoved: false },
    schemaReady: true,
    nextSyncAfter: new Date(Date.now() + 660_000).toISOString(),
    lastSyncedAt: new Date(Date.now() - 240_000).toISOString(),
    lastErrorKey: null,
    consecutiveFailures: 0,
    createdAt: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

function runFixture(
  overrides: Partial<SyncRunSummary> = {},
): SyncRunSummary {
  return {
    id: "bbbbbbb1-1f7e-4a2f-9f1e-2c3d4e5f6a7b" as never,
    trigger: "cron",
    status: "success",
    startedAt: "2026-08-15T11:44:00.000Z",
    finishedAt: "2026-08-15T11:45:00.000Z",
    stats: {
      ...emptySyncRunStats(),
      created: 12,
      updated: 3,
      unchanged: 40,
      tables: 7,
      perTable: [
        { key: "sessions", created: 5, updated: 1, unchanged: 20, deleted: 0, orphans: 0, purgeHeld: 0, deferred: 0 },
        { key: "people", created: 7, updated: 2, unchanged: 20, deleted: 0, orphans: 0, purgeHeld: 0, deferred: 0 },
      ],
    },
    error: null,
    ...overrides,
  };
}

const wrap = (children: ReactNode) => createElement(ToastProvider, null, children);

const panel = (props: Partial<Parameters<typeof AirtableSettingsPanel>[0]> = {}) =>
  renderToStaticMarkup(wrap(createElement(AirtableSettingsPanel, {
    eventId,
    eventName: "SH-5 2026",
    timezone: "UTC",
    initialConnection: null,
    initialRuns: [],
    ...props,
  })));

/**
 * The states this surface can be in, rendered.
 *
 * Server-rendered markup is enough to police the things that actually go wrong
 * on an integration panel: a backend enum leaking into visible copy, a status
 * card that renders before there is anything to put in it, and a remainder
 * that gets rounded away instead of named.
 */
describe("Airtable settings panel states", () => {
  it("A — offers the connect flow, the three-step rail, and no status card", () => {
    const markup = panel();
    expect(markup).toContain("Your program, live in Airtable");
    expect(markup).toContain("Paste a token");
    expect(markup).toContain("Pick a base");
    expect(markup).toContain("Watch it fill");
    expect(markup).toContain("Connect Airtable");
    expect(markup).not.toContain("Sync now");
  });

  it("A — invites an abandoned wizard to pick up where it stopped rather than retype the token", () => {
    const markup = panel({ initialConnection: connectionFixture({ status: "pending", baseId: null, baseName: null }) });
    expect(markup).toContain("Finish connecting");
    expect(markup).toContain("Your token is saved");
  });

  it("E — names the base as a deep link, the account, and the four figures", () => {
    const markup = panel({ initialConnection: connectionFixture(), initialRuns: [runFixture()] });
    expect(markup).toContain('href="https://airtable.com/appABCD12345678"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain("SH-5 2026 Program");
    // `whoami` returns no name, and an email only with `user.email:read`, so
    // the honest fallback is the elided user id — not an invented display name.
    expect(markup).toContain("usr…7f2c");
    expect(markup).toContain("Using token pat…7f2c");
    expect(markup).toContain("Sessions");
    expect(markup).toContain("Speakers");
    expect(markup).toContain("Proposals");
    expect(markup).toContain("Lookups");
    expect(markup).toContain("Last synced 4 minutes ago");
    expect(markup).toContain("Next automatic sync in about 11 minutes.");
  });

  it("E — renders a run outcome as a badge, never as its backend value", () => {
    const markup = panel({ initialConnection: connectionFixture(), initialRuns: [runFixture()] });
    expect(markup).toContain("Completed");
    expect(markup).toContain("Scheduled");
    expect(markup).not.toContain(">success<");
    expect(markup).not.toContain(">cron<");
  });

  it("G — names the remainder instead of rounding it away", () => {
    const run = runFixture();
    const markup = panel({
      initialConnection: connectionFixture(),
      initialRuns: [{ ...run, stats: { ...run.stats, deferred: 118 } }],
    });
    expect(markup).toContain("55 records");
    expect(markup).toContain("118 left");
    expect(markup).toContain("picks up exactly where this one stopped");
  });

  it("H — suspends automatic sync in words an organizer can act on, with no duplication scare", () => {
    const markup = panel({ initialConnection: connectionFixture({ status: "needs_attention" }), initialRuns: [runFixture()] });
    expect(markup).toContain("Airtable stopped accepting your token");
    expect(markup).toContain("nothing gets duplicated");
    expect(markup).toContain("Paste a new token");
  });

  it("I — stays amber and offers a rebuild when the token may change the base's shape", () => {
    const markup = panel({
      // `lastErrorKey` is what the server writes alongside a blocked run, and
      // what tells a schema block apart from a rejected-records one: the banner
      // below offers "Rebuild it", which is only the remedy for the first.
      initialConnection: connectionFixture({ lastErrorKey: "schema_drifted" }),
      initialRuns: [runFixture({ status: "blocked", error: "Some tables or fields in your base don't match what we expect. The list below says exactly which." })],
    });
    expect(markup).toContain("Your base needs one change before the next sync");
    expect(markup).toContain("Rebuild it");
    expect(markup).toContain("Needs attention");
    expect(markup).not.toContain(">blocked<");
  });

  it("I — falls back to a copyable field list when the token cannot change the base", () => {
    const markup = panel({
      initialConnection: connectionFixture({ scopes: ["data.records:read", "data.records:write", "schema.bases:read"], lastErrorKey: "schema_drifted" }),
      initialRuns: [runFixture({ status: "blocked", error: "Some tables or fields in your base don't match what we expect. The list below says exactly which." })],
    });
    expect(markup).toContain("Copy the field list");
    expect(markup).toContain("Openboard ID");
    expect(markup).not.toContain("Rebuild it");
  });

  it("I — does not offer a rebuild for a block that rebuilding cannot fix", () => {
    // `records_rejected` is two of the organizer's own rows sharing a hidden
    // Openboard ID, or a value a column's type will not take. The schema is
    // fine; re-running `ensureBaseSchema` would do nothing but spend meta calls
    // and imply the wrong remedy. The run's own sentence still reaches them,
    // in the history table below.
    const markup = panel({
      initialConnection: connectionFixture({ lastErrorKey: "records_rejected" }),
      initialRuns: [runFixture({
        status: "blocked",
        error: "Airtable wouldn't accept some of these records.",
      })],
    });
    expect(markup).not.toContain("Rebuild it");
    expect(markup).not.toContain("Your base needs one change before the next sync");
    expect(markup).toContain("Airtable wouldn&#x27;t accept some of these records.");
  });

  it("orphans — counts them even with removals off, and does not act without a confirmation", () => {
    const run = runFixture();
    const markup = panel({
      initialConnection: connectionFixture(),
      initialRuns: [{ ...run, stats: { ...run.stats, orphans: 3 } }],
    });
    expect(markup).toContain("3 records are in Airtable but no longer in Openboard.");
    expect(markup).toContain("Remove them");
  });
});

describe("Airtable connect dialog", () => {
  const dialog = (props: Partial<Parameters<typeof ConnectDialog>[0]> = {}) =>
    renderToStaticMarkup(wrap(createElement(ConnectDialog, {
      eventId,
      baseNameSuggestion: "SH-5 2026 — Openboard",
      open: true,
      startAt: "token",
      connection: null,
      onClose: () => undefined,
      onConnection: () => undefined,
      ...props,
    })));

  it("B — discloses what is pushed, what is not, and that it is one-way, before the token field", () => {
    const markup = dialog();
    const disclosureAt = markup.indexOf("What we put in your base");
    const fieldAt = markup.indexOf('type="password"');
    expect(disclosureAt).toBeGreaterThan(-1);
    expect(fieldAt).toBeGreaterThan(disclosureAt);
    expect(markup).toContain("no unsubscribe state");
    expect(markup).toContain("nothing you type there is ever read back");
    expect(markup).toContain("Airtable tokens start with");
  });

  it("B — hides the token by default and keeps browsers from filling or storing it", () => {
    const markup = dialog();
    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain(">Show</button>");
    expect(markup).not.toContain('type="text" value="pat');
  });

  it("B — will not advance to the base step before Airtable has confirmed the token", () => {
    const markup = dialog();
    expect(markup).toContain(">Next</button>");
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>Next<\/button>/u);
  });

  it("C — offers an existing base first and explains why creating one is unavailable", () => {
    const markup = dialog({
      startAt: "base",
      connection: connectionFixture({ status: "pending", baseId: null, baseName: null, scopes: ["data.records:read", "data.records:write", "schema.bases:read"] }),
    });
    expect(markup).toContain("Use an existing base");
    expect(markup).toContain("Create a new base for me");
    expect(markup).toContain("This token can&#x27;t create bases");
    expect(markup).toMatch(/<input type="radio" disabled=""[^>]*name="airtable-base-choice"/u);
  });
});
