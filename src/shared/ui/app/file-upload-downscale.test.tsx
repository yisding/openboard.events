/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileUpload } from "./file-upload";
import { settle } from "@tests/support/react";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const MB = 1024 * 1024;

/**
 * happy-dom has no 2d rendering, so `downscale`'s canvas work is stubbed down to
 * the two decisions under test: how much smaller the result is, and what type it
 * is encoded as. Everything around it — the ordering of the size check, the
 * `sizeBytes` sent at presign — is the component's own code.
 */
let encodedType = "";
let encodedBytes = 0;

function stubCanvas(outputBytes: number) {
  encodedBytes = outputBytes;
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4000, height: 3000, close: () => undefined })));
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: () => undefined })) as unknown as HTMLCanvasElement["getContext"];
  HTMLCanvasElement.prototype.toBlob = function toBlob(callback: BlobCallback, type?: string) {
    encodedType = type ?? "";
    callback(new Blob([new Uint8Array(encodedBytes)], { type: encodedType }));
  };
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  encodedType = "";
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: "presign refused" } }), {
    status: 400,
    headers: { "content-type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function pick(file: File) {
  await act(async () => root.render(
    <FileUpload eventId="e1" kind="headshot" onUploaded={() => undefined} />,
  ));
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("expected a file input");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
}

describe("FileUpload downscaling", () => {
  it("checks the size limit against the downscaled bytes the server will actually see", async () => {
    // An ordinary 12 MP phone photo — exactly the case `downscale` exists for.
    // The limit used to be applied to the picked file, so this was refused with
    // "That file is 6.0 MB — the limit is 5 MB", a limit that would never have
    // applied to the ~200 KB that was actually going to be uploaded.
    stubCanvas(200 * 1024);
    await pick(new File([new Uint8Array(6 * MB)], "headshot.jpg", { type: "image/jpeg" }));

    expect(container.textContent).not.toContain("the limit is 5 MB");
    // It got as far as presign, and declared the post-downscale size.
    expect(fetchMock).toHaveBeenCalled();
    expect(bodyOf(fetchMock.mock.calls[0] as unknown[]).sizeBytes).toBe(200 * 1024);
  });

  it("still refuses a file that is over the limit after downscaling", async () => {
    stubCanvas(9 * MB);
    await pick(new File([new Uint8Array(20 * MB)], "headshot.jpg", { type: "image/jpeg" }));

    expect(container.textContent).toContain("the limit is 5 MB");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a PNG a PNG, so a transparent logo is not flattened onto black", async () => {
    // A canvas encodes to a format without alpha by compositing onto solid
    // black. PNG is an accepted logo type and anything over the kind's max edge
    // is re-encoded, so an organizer's transparent brand logo used to land in R2
    // — and be served publicly from `/f/<fileId>` — inside a black square.
    stubCanvas(100 * 1024);
    await pick(new File([new Uint8Array(2 * MB)], "logo.png", { type: "image/png" }));

    expect(encodedType).toBe("image/png");
    expect(bodyOf(fetchMock.mock.calls[0] as unknown[]).mime).toBe("image/png");
    expect(bodyOf(fetchMock.mock.calls[0] as unknown[]).filename).toBe("logo.png");
  });

  it("still re-encodes a photograph to JPEG, which is the point of shrinking it", async () => {
    stubCanvas(300 * 1024);
    await pick(new File([new Uint8Array(6 * MB)], "headshot.jpeg", { type: "image/jpeg" }));

    expect(encodedType).toBe("image/jpeg");
    expect(bodyOf(fetchMock.mock.calls[0] as unknown[]).filename).toBe("headshot.jpg");
  });

  it("keeps the original when re-encoding would make it bigger", async () => {
    stubCanvas(3 * MB);
    await pick(new File([new Uint8Array(1 * MB)], "logo.png", { type: "image/png" }));

    expect(bodyOf(fetchMock.mock.calls[0] as unknown[]).sizeBytes).toBe(1 * MB);
  });
});
