/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { settle } from "@tests/support/react";
import { AIRTABLE_COPY } from "../copy";
import type { AirtableConnectionSummary, AirtableTokenVerdict } from "../schemas";
import { ConnectDialog } from "./ConnectDialog";

/**
 * The three things the wizard's own comments say it is shaped to survive, none
 * of which any test held it to.
 *
 * `panel-states.test.tsx` renders the dialog's steps to static HTML and
 * `AirtableSettingsPanel.test.tsx` walks the happy path in from the panel.
 * Neither can reach a race between two validations, a base list that failed to
 * load, or the state a second pass through the wizard inherits from the first —
 * and each of those, when it breaks, produces a wizard that looks fine and is
 * wrong: Next enabled on a verdict the pasted token never earned, a "you have
 * no bases" dead end conjured out of a network blip, and a base list belonging
 * to a token that is no longer in the field.
 */
const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("c0000000-0000-4000-8000-0000000000b1");
const VALIDATE_DEBOUNCE_MS = 500;

function verdict(overrides: Partial<AirtableTokenVerdict> = {}): AirtableTokenVerdict {
  return {
    airtableUserId: "usrABCD1234EF7f2c",
    accountEmail: null,
    scopes: ["data.records:read", "data.records:write", "schema.bases:read", "schema.bases:write"],
    canConnect: true,
    canManageSchema: true,
    missingRequired: [],
    missingOptional: [],
    ...overrides,
  };
}

function connectionFixture(overrides: Partial<AirtableConnectionSummary> = {}): AirtableConnectionSummary {
  return {
    id: "bbbbbbb1-1f7e-4a2f-9f1e-2c3d4e5f6a7b" as AirtableConnectionSummary["id"],
    status: "pending",
    airtableUserId: "usrABCD1234EF7f2c",
    accountEmail: null,
    tokenHint: "7f2c",
    scopes: ["data.records:read", "data.records:write", "schema.bases:read", "schema.bases:write"],
    baseId: null,
    baseName: null,
    syncEnabled: true,
    options: { includeEmail: true, includeBio: true, includePronouns: false, includeGender: false, includeHeadshots: true, pruneRemoved: false },
    schemaReady: false,
    nextSyncAfter: new Date().toISOString(),
    lastSyncedAt: null,
    lastErrorKey: null,
    consecutiveFailures: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

function text(): string {
  return container.textContent ?? "";
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === name);
}

function edit(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function passDebounce() {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, VALIDATE_DEBOUNCE_MS + 100); }); });
  await settle();
}

async function renderDialog(props: Partial<Parameters<typeof ConnectDialog>[0]> = {}) {
  await act(async () => root.render(
    <ConnectDialog
      eventId={eventId}
      baseNameSuggestion="SH-5 2026 — Openboard"
      open
      startAt="token"
      connection={null}
      onClose={() => undefined}
      onConnection={() => undefined}
      {...props}
    />,
  ));
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

describe("validating a token that is still being edited", () => {
  it("lets only the token in the field decide whether Next opens", async () => {
    const onConnection = vi.fn();
    let answerFirst: (value: unknown) => void = () => undefined;
    // A paste, then a correction: the first request is already in flight when
    // the second starts, and the debounce cancels timers, not requests.
    apiMock.mockImplementationOnce(() => new Promise((resolve) => { answerFirst = resolve; }));
    apiMock.mockResolvedValueOnce({
      connection: connectionFixture(),
      verdict: verdict({
        scopes: ["data.records:read"],
        canConnect: false,
        canManageSchema: false,
        missingRequired: ["data.records:write"],
      }),
    });

    await renderDialog({ onConnection });
    const field = container.querySelector<HTMLInputElement>('input[type="password"]');
    if (!field) throw new Error("The token step must offer a masked field");

    await act(async () => edit(field, "patABANDONED0000000001"));
    await passDebounce();
    await act(async () => edit(field, "patCORRECTED0000000002"));
    await passDebounce();

    // The abandoned token's answer arrives last and says "this one can
    // connect". It is a verdict about a token nobody is holding any more.
    await act(async () => answerFirst({ connection: connectionFixture(), verdict: verdict() }));
    await settle();

    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(buttonNamed(AIRTABLE_COPY.token.next)?.disabled).toBe(true);
    expect(text()).toContain(AIRTABLE_COPY.token.blockedByScopes);
    // The panel behind the dialog must not be handed the stale connection
    // either — it is what the settings card would then render.
    expect(onConnection).toHaveBeenCalledTimes(1);
  });

  it("asks Airtable nothing until the organizer stops typing, and nothing at all about a malformed token", async () => {
    await renderDialog();
    const field = container.querySelector<HTMLInputElement>('input[type="password"]');
    if (!field) throw new Error("The token step must offer a masked field");

    await act(async () => edit(field, "not-a-pat"));
    await passDebounce();
    expect(apiMock).not.toHaveBeenCalled();

    apiMock.mockResolvedValue({ connection: connectionFixture(), verdict: verdict() });
    await act(async () => edit(field, "patTYPINGSTILL00000001"));
    await act(async () => edit(field, "patTYPINGSTILL00000012"));
    await passDebounce();

    // One request for the value that settled, not one per keystroke.
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock.mock.calls[0]?.[2]).toMatchObject({ body: { token: "patTYPINGSTILL00000012" } });
    expect(buttonNamed(AIRTABLE_COPY.token.next)?.disabled).toBe(false);
  });
});

describe("listing the bases a token can see", () => {
  const atBaseStep = { startAt: "base" as const, connection: connectionFixture() };

  it("treats a failed list as a failed list, not as an account with no bases", async () => {
    apiMock.mockRejectedValueOnce(new AppError("INTERNAL", "Airtable didn't answer"));

    await renderDialog(atBaseStep);
    await settle();

    expect(text()).toContain(AIRTABLE_COPY.base.retryList);
    // The dead end this guards: `bases = []` would say the load finished *and*
    // that this token sees nothing, which forces "create a new base for me" —
    // a step a token without `schema.bases:write` cannot take.
    expect(text()).not.toContain(AIRTABLE_COPY.base.noBases);
    expect(text()).not.toContain(AIRTABLE_COPY.base.loadingBases);
  });

  it("asks again exactly once when the organizer retries, and shows what came back", async () => {
    apiMock.mockRejectedValueOnce(new AppError("INTERNAL", "Airtable didn't answer"));
    await renderDialog(atBaseStep);
    await settle();

    apiMock.mockResolvedValueOnce({ bases: [{ id: "appONE", name: "Program 2026", permissionLevel: "create" }] });
    await act(async () => buttonNamed(AIRTABLE_COPY.base.retryList)?.click());
    await settle();

    // One request per click. Clearing the error re-arms the load effect, so a
    // retry that also called the loader directly sent the same request twice.
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(text()).toContain("Program 2026");
    expect(text()).not.toContain(AIRTABLE_COPY.base.retryList);
  });

  it("re-asks on a second pass instead of showing the previous token's bases", async () => {
    apiMock.mockResolvedValueOnce({ bases: [{ id: "appOLD", name: "Old token's base", permissionLevel: "create" }] });
    await renderDialog(atBaseStep);
    await settle();
    expect(text()).toContain("Old token's base");

    // Closed and reopened — a reconnect, or a different token pasted after a
    // dead end. `bases` is the list *one particular token* could see.
    await renderDialog({ ...atBaseStep, open: false });
    apiMock.mockResolvedValueOnce({ bases: [{ id: "appNEW", name: "New token's base", permissionLevel: "create" }] });
    await renderDialog(atBaseStep);
    await settle();

    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(text()).toContain("New token's base");
    expect(text()).not.toContain("Old token's base");
  });
});
