"use client";

import { Upload, X } from "lucide-react";
import React, { useRef, useState } from "react";
import type { FileKind } from "@/shared/contracts";
import { cn } from "@/shared/lib/cn";
import { PrivateFileLink } from "./private-file-link";

/**
 * Presigned PUT straight to R2. Bytes never pass through the Worker: the server
 * hands back a signed URL, the browser PUTs to it with XHR for progress, and the
 * server then verifies what actually landed.
 *
 * `onUploaded` fires **only** after finalize returns ready. A rejected finalize
 * deletes both the R2 object and its row, so a caller that stores a fileId any
 * earlier ends up pointing at nothing.
 *
 * The limits below are for the person using the form. The server enforces the
 * same policy at presign and again at finalize, and it is the one that counts.
 */
const CLIENT_POLICY: Record<FileKind, { accept: string; maxSizeMb: number; downscaleTo?: number }> = {
  headshot: { accept: "image/png,image/jpeg,image/webp", maxSizeMb: 5, downscaleTo: 1024 },
  logo: { accept: "image/png,image/jpeg,image/webp", maxSizeMb: 5, downscaleTo: 600 },
  background: { accept: "image/png,image/jpeg,image/webp", maxSizeMb: 5, downscaleTo: 1920 },
  slide: { accept: ".pdf,.ppt,.pptx,.key,.zip", maxSizeMb: 100 },
  attachment: { accept: ".pdf,.png,.jpg,.jpeg,.docx,.zip", maxSizeMb: 25 },
  upload: { accept: "", maxSizeMb: 100 },
};

type Phase = "idle" | "validating" | "downscaling" | "presigning" | "uploading" | "finalizing" | "done" | "error";

export type UploadedMeta = { filename: string; sizeBytes: number; mime: string };

/**
 * Shrinks an image before it leaves the browser. This is what removes the whole
 * server-side image-processing risk class — there is no sharp on Workers, and a
 * 12 MP phone photo as a headshot is otherwise both a slow upload and a slow page.
 */
async function downscale(file: File, maxEdge: number): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  if (scale === 1) return file;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
}

export async function postJson(path: string, body: unknown): Promise<{ ok: boolean; data?: Record<string, unknown>; message: string }> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: "The server could not be reached — check your connection and retry" };
  }
  const payload = await response.json().catch(() => null) as { data?: Record<string, unknown>; error?: { message?: string } } | null;
  if (!response.ok || !payload?.data) {
    return { ok: false, message: payload?.error?.message ?? "Something went wrong" };
  }
  return { ok: true, data: payload.data, message: "" };
}

/** XHR rather than fetch: only XHR reports upload progress. */
function putWithProgress(url: string, file: File, headers: Record<string, string>, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`the upload was refused (${request.status})`));
    });
    request.addEventListener("error", () => reject(new Error("the upload failed — check your connection and retry")));
    request.addEventListener("abort", () => reject(new Error("cancelled")));
    request.send(file);
  });
}

export function FileUpload({
  eventId,
  kind,
  onUploaded,
  accept,
  maxSizeMb,
  currentFileId,
  fileRequestId,
  label = "Choose a file",
}: {
  eventId: string;
  kind: FileKind;
  onUploaded: (fileId: string, meta: UploadedMeta) => void | boolean | Promise<void | boolean>;
  accept?: string;
  maxSizeMb?: number;
  currentFileId?: string | null;
  fileRequestId?: string;
  label?: string;
}) {
  const policy = CLIENT_POLICY[kind];
  const limitMb = maxSizeMb ?? policy.maxSizeMb;
  const [phase, setPhase] = useState<Phase>(currentFileId ? "done" : "idle");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState<{ fileId: string; meta: UploadedMeta } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function fail(reason: string) {
    setError(reason);
    setPhase("error");
  }

  async function upload(picked: File) {
    setError("");
    setPhase("validating");
    if (picked.size > limitMb * 1024 * 1024) {
      fail(`That file is ${(picked.size / (1024 * 1024)).toFixed(1)} MB — the limit is ${limitMb} MB.`);
      return;
    }

    let file = picked;
    if (policy.downscaleTo) {
      setPhase("downscaling");
      file = await downscale(picked, policy.downscaleTo);
    }

    setPhase("presigning");
    const presigned = await postJson("/api/uploads/presign", {
      eventId,
      kind,
      filename: file.name,
      mime: file.type || "application/octet-stream",
      sizeBytes: file.size,
      ...(fileRequestId ? { fileRequestId } : {}),
    });
    if (!presigned.ok) {
      fail(presigned.message);
      return;
    }
    const fileId = String(presigned.data?.fileId ?? "");
    const uploadUrl = String(presigned.data?.uploadUrl ?? "");
    const requiredHeaders = (presigned.data?.requiredHeaders ?? {}) as Record<string, string>;

    setPhase("uploading");
    setPercent(0);
    try {
      await putWithProgress(uploadUrl, file, requiredHeaders, setPercent);
    } catch (uploadError) {
      fail(uploadError instanceof Error ? uploadError.message : "the upload failed");
      return;
    }

    // Finalize is where the server checks the bytes that actually landed, so its
    // rejection reason is the only honest thing to show.
    setPhase("finalizing");
    const finalized = await postJson("/api/uploads/finalize", { fileId });
    if (!finalized.ok) {
      fail(finalized.message);
      return;
    }
    if (finalized.data?.status !== "ready") {
      fail(String(finalized.data?.reason ?? "the file was rejected"));
      return;
    }

    const meta: UploadedMeta = { filename: file.name, sizeBytes: file.size, mime: file.type };
    try {
      // Some callers have a second server mutation after finalization (for
      // example, attaching this asset to a portal task). Wait for that mutation
      // before showing the file as complete; a finalized but unattached asset is
      // not a completed task.
      const attached = await onUploaded(fileId, meta);
      if (attached === false) {
        fail("The file uploaded, but could not be attached to this task — try again");
        return;
      }
    } catch (callbackError) {
      fail(callbackError instanceof Error ? callbackError.message : "The file could not be attached — try again");
      return;
    }
    setUploaded({ fileId, meta });
    setPhase("done");
  }

  const busy = phase === "validating" || phase === "downscaling" || phase === "presigning" || phase === "uploading" || phase === "finalizing";
  const shownFileId = uploaded?.fileId ?? currentFileId ?? null;

  return (
    <div className={cn("file-upload", `file-upload--${phase}`)}>
      <input
        ref={inputRef}
        type="file"
        accept={accept ?? policy.accept}
        hidden
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = "";
          if (picked) void upload(picked);
        }}
      />

      {phase === "done" && shownFileId ? (
        <div className="file-upload__done">
          {/* Immutable by construction: a replacement always mints a new fileId,
              which is what makes this URL cacheable forever. */}
          <PrivateFileLink fileId={shownFileId}>{uploaded?.meta.filename ?? "Current file"}</PrivateFileLink>
          <button type="button" className="button button-secondary button-sm" onClick={() => { setPhase("idle"); inputRef.current?.click(); }}>
            Replace
          </button>
        </div>
      ) : (
        <button type="button" className="file-upload__drop" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Upload size={18} />
          <span>{busy ? PHASE_LABEL[phase] : label}</span>
          <small>Up to {limitMb} MB</small>
        </button>
      )}

      {phase === "uploading" && (
        <div className="file-upload__progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${percent}%` }} />
        </div>
      )}

      {phase === "error" && (
        <p className="file-upload__error" role="alert">
          <X size={14} /> {error}{" "}
          <button type="button" onClick={() => { setPhase("idle"); setError(""); }}>Try again</button>
        </p>
      )}
    </div>
  );
}

const PHASE_LABEL: Record<Phase, string> = {
  idle: "",
  validating: "Checking the file…",
  downscaling: "Resizing…",
  presigning: "Starting the upload…",
  uploading: "Uploading…",
  finalizing: "Verifying…",
  done: "",
  error: "",
};
