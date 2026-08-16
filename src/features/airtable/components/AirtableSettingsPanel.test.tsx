/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { settle } from "@tests/support/react";
import { AIRTABLE_COPY } from "../copy";
import { emptySyncRunStats, type AirtableConnectionSummary, type SyncRunSummary } from "../schemas";
import { scopeGuidance } from "../scopes";
import { AirtableSettingsPanel } from "./AirtableSettingsPanel";

/**
 * The panel's *behaviour*, not its markup.
 *
 * `panel-states.test.tsx` renders each state to static HTML and polices the
 * copy in it, which cannot see anything that only happens on a click: whether
 * disconnect actually asks first, whether a failed toggle rolls back, whether
 * the button offered to a blocked run is one that can possibly work. Every
 * assertion here goes through a real DOM event and a mocked `api`, so a handler
 * that stops calling the endpoint — or calls the wrong one — fails a test
 * rather than passing a source scan.
 */

const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/events/e/settings/airtable",
  useSearchParams: () => new URLSearchParams(),
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("c0000000-0000-4000-8000-0000000000a1");
const FAKE_PAT = "patFAKE0000000000TESTONLY";
const VALIDATE_DEBOUNCE_MS = 500;

function connectionFixture(overrides: Partial<AirtableConnectionSummary> = {}): AirtableConnectionSummary {
  return {
    id: "aaaaaaa1-1f7e-4a2f-9f1e-2c3d4e5f6a7b" as AirtableConnectionSummary["id"],
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

function runFixture(overrides: Partial<SyncRunSummary> = {}): SyncRunSummary {
  return {
    id: "bbbbbbb1-1f7e-4a2f-9f1e-2c3d4e5f6a7b" as SyncRunSummary["id"],
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

let container: HTMLDivElement;
let root: Root;

function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .filter((button) => button.textContent?.trim() === name);
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return buttonsNamed(name)[0];
}

function text(): string {
  return container.textContent ?? "";
}

/** Types into a controlled input the way a person does — value set, event fired. */
function edit(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The connect dialog debounces validation; nothing is asked of Airtable before it elapses. */
async function passDebounce() {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, VALIDATE_DEBOUNCE_MS + 100); }); });
  await settle();
}

beforeEach(() => {
  apiMock.mockReset();
  toastMock.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() { this.open = false; };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderPanel(props: {
  connection?: AirtableConnectionSummary | null;
  runs?: SyncRunSummary[];
} = {}) {
  await act(async () => root.render(
    <AirtableSettingsPanel
      eventId={eventId}
      eventName="SH-5 2026"
      timezone="UTC"
      initialConnection={props.connection ?? null}
      initialRuns={props.runs ?? []}
    />,
  ));
}

/** The `GET …/airtable` refresh every write path ends with. */
function statusResponse(connection: AirtableConnectionSummary | null, runs: SyncRunSummary[] = []) {
  return { connection, runs };
}

describe("connecting", () => {
  it("opens the wizard from the empty state, with the disclosure before the token field", async () => {
    await renderPanel();
    expect(text()).toContain(AIRTABLE_COPY.empty.title);
    expect(container.querySelector('input[type="password"]')).toBeNull();

    await act(async () => buttonNamed(AIRTABLE_COPY.empty.connect)?.click());

    expect(text()).toContain(AIRTABLE_COPY.token.heading);
    const markup = container.innerHTML;
    expect(markup.indexOf(AIRTABLE_COPY.disclosure.title)).toBeGreaterThan(-1);
    expect(markup.indexOf('type="password"')).toBeGreaterThan(markup.indexOf(AIRTABLE_COPY.disclosure.title));
    expect(apiMock).not.toHaveBeenCalled();
  });

  /**
   * The one scope whose absence means nothing can ever reach the base. Letting
   * "Next" through here would spend the organizer's time on a base picker and a
   * first sync that could only end blocked.
   */
  it("refuses to advance a token missing data.records:write, and names the permission to add", async () => {
    apiMock.mockResolvedValueOnce({
      connection: connectionFixture({ status: "pending", baseId: null, baseName: null }),
      verdict: {
        airtableUserId: "usrABCD1234EF7f2c",
        accountEmail: null,
        scopes: ["data.records:read", "schema.bases:read"],
        canConnect: false,
        canManageSchema: false,
        missingRequired: ["data.records:write"],
        missingOptional: ["schema.bases:write", "user.email:read"],
      },
    });
    await renderPanel();
    await act(async () => buttonNamed(AIRTABLE_COPY.empty.connect)?.click());

    const field = container.querySelector<HTMLInputElement>('input[type="password"]');
    if (!field) throw new Error("expected the token field");
    await act(async () => edit(field, FAKE_PAT));
    await passDebounce();

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock.mock.calls[0]?.[0]).toBe(`events/${eventId}/airtable/token`);
    expect(apiMock.mock.calls[0]?.[2]).toEqual({ method: "POST", body: { token: FAKE_PAT } });
    expect(buttonNamed(AIRTABLE_COPY.token.next)?.disabled).toBe(true);
    expect(text()).toContain(AIRTABLE_COPY.token.blockedByScopes);
    expect(text()).toContain(scopeGuidance("data.records:write").why);
  });

  it("lets a token through that only lacks the optional schema scope, and says what it cannot do", async () => {
    apiMock.mockResolvedValueOnce({
      connection: connectionFixture({ status: "pending", baseId: null, baseName: null }),
      verdict: {
        airtableUserId: "usrABCD1234EF7f2c",
        accountEmail: null,
        scopes: ["data.records:read", "data.records:write", "schema.bases:read"],
        canConnect: true,
        canManageSchema: false,
        missingRequired: [],
        missingOptional: ["schema.bases:write"],
      },
    });
    apiMock.mockResolvedValueOnce({ bases: [{ id: "appABCD12345678", name: "Programme", permissionLevel: "create" }] });
    await renderPanel();
    await act(async () => buttonNamed(AIRTABLE_COPY.empty.connect)?.click());

    const field = container.querySelector<HTMLInputElement>('input[type="password"]');
    if (!field) throw new Error("expected the token field");
    await act(async () => edit(field, FAKE_PAT));
    await passDebounce();

    const next = buttonNamed(AIRTABLE_COPY.token.next);
    expect(next?.disabled).toBe(false);
    await act(async () => next?.click());
    await settle();

    expect(text()).toContain(AIRTABLE_COPY.base.useExisting);
    // Creating a base needs the scope this token does not hold, so that path is
    // closed and explained rather than offered and then refused by the server.
    expect(text()).toContain(AIRTABLE_COPY.base.createBlocked);
    expect(apiMock.mock.calls[1]?.[0]).toBe(`events/${eventId}/airtable/bases`);
  });
});

describe("the connected card", () => {
  it("deep-links the base and reports what a manual sync landed", async () => {
    const connection = connectionFixture();
    const run = runFixture({ trigger: "manual" });
    apiMock.mockResolvedValueOnce({ run });
    apiMock.mockResolvedValueOnce(statusResponse(connection, [run]));
    await renderPanel({ connection, runs: [runFixture()] });

    expect(container.querySelector<HTMLAnchorElement>('a[href="https://airtable.com/appABCD12345678"]')).not.toBeNull();

    await act(async () => buttonNamed(AIRTABLE_COPY.connected.syncNow)?.click());
    await settle();

    expect(apiMock.mock.calls[0]?.[0]).toBe(`events/${eventId}/airtable/sync`);
    expect(apiMock.mock.calls[0]?.[2]).toEqual({ method: "POST" });
    expect(toastMock).toHaveBeenCalledWith(AIRTABLE_COPY.connected.syncedToast(55));
  });

  it("says nothing changed rather than claiming a sync that moved no records", async () => {
    const connection = connectionFixture();
    const idle = runFixture({ stats: { ...emptySyncRunStats(), unchanged: 55 } });
    apiMock.mockResolvedValueOnce({ run: idle });
    apiMock.mockResolvedValueOnce(statusResponse(connection, [idle]));
    await renderPanel({ connection, runs: [runFixture()] });

    await act(async () => buttonNamed(AIRTABLE_COPY.connected.syncNow)?.click());
    await settle();

    expect(toastMock).toHaveBeenCalledWith(AIRTABLE_COPY.connected.nothingToDoToast);
  });

  it("surfaces a run that came back blocked as an error, in the run's own words", async () => {
    const connection = connectionFixture();
    const blocked = runFixture({ status: "blocked", error: AIRTABLE_COPY.baseMissing.body });
    apiMock.mockResolvedValueOnce({ run: blocked });
    apiMock.mockResolvedValueOnce(statusResponse(connection, [blocked]));
    await renderPanel({ connection, runs: [runFixture()] });

    await act(async () => buttonNamed(AIRTABLE_COPY.connected.syncNow)?.click());
    await settle();

    expect(toastMock).toHaveBeenCalledWith(AIRTABLE_COPY.baseMissing.body, { kind: "error" });
  });

  it("rolls a failed toggle back to what the server still holds", async () => {
    const connection = connectionFixture();
    apiMock.mockRejectedValueOnce(new AppError("VALIDATION", "That setting isn't one we know"));
    await renderPanel({ connection, runs: [runFixture()] });

    await act(async () => buttonNamed(AIRTABLE_COPY.connected.whatWeSync)?.click());
    const pronouns = container.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${AIRTABLE_COPY.options.includePronouns.label}"]`);
    expect(pronouns?.getAttribute("aria-checked")).toBe("false");

    await act(async () => pronouns?.click());
    await settle();

    expect(apiMock.mock.calls[0]?.[2]).toEqual({ method: "PATCH", body: { includePronouns: true } });
    expect(container.querySelector(`[role="switch"][aria-label="${AIRTABLE_COPY.options.includePronouns.label}"]`)?.getAttribute("aria-checked")).toBe("false");
    expect(toastMock).toHaveBeenCalledWith("That setting isn't one we know", { kind: "error" });
  });
});

describe("disconnecting", () => {
  it("asks first, names the base in the question, and does nothing if the answer is no", async () => {
    const connection = connectionFixture();
    await renderPanel({ connection, runs: [runFixture()] });

    await act(async () => buttonNamed(AIRTABLE_COPY.connected.disconnect)?.click());
    expect(text()).toContain(AIRTABLE_COPY.disconnect.title);
    expect(text()).toContain(AIRTABLE_COPY.disconnect.body("SH-5 2026 Program"));

    await act(async () => buttonNamed(AIRTABLE_COPY.disconnect.cancel)?.click());
    await settle();
    expect(apiMock).not.toHaveBeenCalled();
    expect(text()).toContain("SH-5 2026 Program");
  });

  it("deletes the connection on confirmation and returns the panel to its empty state", async () => {
    apiMock.mockResolvedValueOnce({ disconnected: true });
    apiMock.mockResolvedValueOnce(statusResponse(null, []));
    await renderPanel({ connection: connectionFixture(), runs: [runFixture()] });

    await act(async () => buttonNamed(AIRTABLE_COPY.connected.disconnect)?.click());
    await act(async () => buttonsNamed(AIRTABLE_COPY.disconnect.confirm).at(-1)?.click());
    await settle();

    expect(apiMock.mock.calls[0]?.[0]).toBe(`events/${eventId}/airtable`);
    expect(apiMock.mock.calls[0]?.[2]).toEqual({ method: "DELETE" });
    expect(toastMock).toHaveBeenCalledWith(AIRTABLE_COPY.disconnect.done);
    expect(text()).toContain(AIRTABLE_COPY.empty.title);
  });
});

describe("a run that came back blocked", () => {
  it("names both numbers when the circuit breaker held a purge back", async () => {
    const run = runFixture({
      stats: {
        ...emptySyncRunStats(),
        purgeHeld: 8,
        perTable: [
          { key: "sessions", created: 0, updated: 0, unchanged: 20, deleted: 0, orphans: 8, purgeHeld: 8, deferred: 0 },
        ],
      },
    });
    await renderPanel({ connection: connectionFixture({ options: { ...connectionFixture().options, pruneRemoved: true } }), runs: [run] });

    // 8 held out of the 20 still tracked plus the 8 about to go.
    expect(text()).toContain(AIRTABLE_COPY.orphans.held(8, 28, "Sessions"));
  });

  it("offers a rebuild to a token that can change the base, and re-selects the same base to do it", async () => {
    const connection = connectionFixture();
    apiMock.mockResolvedValueOnce({
      connection,
      created: false,
      schema: { ok: true, reason: null, issues: [], createdTables: 1, createdFields: 2 },
    });
    await renderPanel({ connection, runs: [runFixture({ status: "blocked", error: "Some tables or fields don't match." })] });

    await act(async () => buttonNamed(AIRTABLE_COPY.blocked.rebuild)?.click());
    await settle();

    expect(apiMock.mock.calls[0]?.[0]).toBe(`events/${eventId}/airtable/bases`);
    expect(apiMock.mock.calls[0]?.[2]).toEqual({ method: "POST", body: { action: "select", baseId: "appABCD12345678" } });
    expect(toastMock).toHaveBeenCalledWith(AIRTABLE_COPY.blocked.rebuilt);
  });

  it("gives a read-only token the field list instead of a button it cannot use", async () => {
    const copied: string[] = [];
    const writeText = vi.fn(async (value: string) => { copied.push(value); });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await renderPanel({
      connection: connectionFixture({ scopes: ["data.records:read", "data.records:write", "schema.bases:read"] }),
      runs: [runFixture({ status: "blocked", error: "Some tables or fields don't match." })],
    });

    expect(buttonNamed(AIRTABLE_COPY.blocked.rebuild)).toBeUndefined();
    expect(text()).toContain("Openboard ID");

    await act(async () => buttonNamed(AIRTABLE_COPY.blocked.copyFields)?.click());
    await settle();

    expect(writeText).toHaveBeenCalledOnce();
    expect(copied[0]).toContain("Openboard ID");
    expect(toastMock).toHaveBeenCalledWith(AIRTABLE_COPY.blocked.copied);
  });

  /**
   * A deleted base leaves the connection `connected` and every run `blocked`,
   * and the schema banner's only action is a re-select of the base that is
   * gone — a button that can do nothing but fail, forever. The recovery has to
   * be a different base.
   */
  it("offers a different base when the connected one is gone, not a rebuild of it", async () => {
    apiMock.mockResolvedValueOnce({ bases: [{ id: "appNEWBASE00001", name: "Programme 2027", permissionLevel: "create" }] });
    await renderPanel({
      connection: connectionFixture({ lastErrorKey: "base_missing" }),
      runs: [runFixture({ status: "blocked", error: "We can't see that base any more." })],
    });

    expect(text()).toContain(AIRTABLE_COPY.baseMissing.title);
    expect(buttonNamed(AIRTABLE_COPY.blocked.rebuild)).toBeUndefined();

    await act(async () => buttonNamed(AIRTABLE_COPY.baseMissing.action)?.click());
    await settle();

    // Straight to the base picker: the token is fine, the base is not.
    expect(text()).toContain(AIRTABLE_COPY.base.heading);
    expect(text()).toContain("Programme 2027");
    expect(apiMock.mock.calls[0]?.[0]).toBe(`events/${eventId}/airtable/bases`);
  });
});
