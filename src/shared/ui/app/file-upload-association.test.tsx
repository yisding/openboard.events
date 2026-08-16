/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileUpload } from "./file-upload";
import { settle } from "@tests/support/react";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const FILE_ID = "c4000000-0000-4000-8000-0000000000a1";

/**
 * Just enough XHR for the PUT to R2 to succeed — the component reaches for it
 * rather than `fetch` because only XHR reports upload progress, so a suite that
 * stubs `fetch` alone never gets past the bytes.
 */
class FakeUploadRequest {
  status = 200;
  upload = { addEventListener: () => undefined };
  private handlers: Record<string, Array<() => void>> = {};
  open(_method: string, url: string) { putUrls.push(url); }
  setRequestHeader() { /* signed headers are asserted elsewhere */ }
  addEventListener(type: string, handler: () => void) { (this.handlers[type] ??= []).push(handler); }
  send() { queueMicrotask(() => this.handlers.load?.forEach((handler) => handler())); }
}

let container: HTMLDivElement;
let root: Root;
let putUrls: string[];
let fetchMock: ReturnType<typeof vi.fn>;
let uploadedWith: string[];

function jsonResponse(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  putUrls = [];
  uploadedWith = [];
  fetchMock = vi.fn(async (path: string) => (
    path === "/api/uploads/presign"
      ? jsonResponse({ fileId: FILE_ID, uploadUrl: "https://r2.example/staging/put", requiredHeaders: { "Content-Type": "application/pdf" } })
      : jsonResponse({ status: "ready" })
  ));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function pickInto(associationFinalizes: boolean) {
  await act(async () => root.render(
    <FileUpload
      eventId="e1"
      kind="upload"
      fileRequestId="c4000000-0000-4000-8000-0000000000b1"
      associationFinalizes={associationFinalizes}
      onUploaded={(fileId) => { uploadedWith.push(fileId); }}
    />,
  ));
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("expected a file input");
  const file = new File([new Uint8Array(64)], "deck.pdf", { type: "application/pdf" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
}

const posted = () => fetchMock.mock.calls.map((call) => String(call[0]));

describe("FileUpload — who finalizes", () => {
  it("finalizes on its own by default, before handing the fileId over", async () => {
    await pickInto(false);

    expect(posted()).toEqual(["/api/uploads/presign", "/api/uploads/finalize"]);
    expect(putUrls).toEqual(["https://r2.example/staging/put"]);
    expect(uploadedWith).toEqual([FILE_ID]);
  });

  it("leaves the bytes staged when the association endpoint finalizes", async () => {
    // #621: publishing here and associating in a second request meant a dropped
    // connection between them left the file in R2 under its immutable key with
    // nothing pointing at it, and nobody told. Nothing may be published until
    // the one request that also records it.
    await pickInto(true);

    expect(posted()).toEqual(["/api/uploads/presign"]);
    expect(putUrls).toEqual(["https://r2.example/staging/put"]);
    expect(uploadedWith).toEqual([FILE_ID]);
  });
});
