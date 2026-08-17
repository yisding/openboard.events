"use client";

import { Upload, X } from "lucide-react";
import React, { useRef, useState } from "react";
import type { FileKind } from "@/shared/contracts";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/ui-kit";
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
 * `associationFinalizes` inverts that for callers whose own endpoint finalizes:
 * see the prop's note below.
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

type Phase = "idle" | "validating" | "downscaling" | "presigning" | "uploading" | "finalizing" | "associating" | "done" | "error";

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
  // PNG stays PNG. A format without alpha is composited onto solid black by the
  // canvas spec, so re-encoding unconditionally to JPEG flattened a transparent
  // brand logo — PNG is an accepted `logo` type and anything over 600px on its
  // longest edge is re-encoded — onto a black square, publicly at `/f/<fileId>`,
  // with no warning and nothing to recover from. Photographic kinds keep JPEG,
  // which is the whole point of the size reduction.
  const keepsAlpha = file.type === "image/png";
  const mime = keepsAlpha ? "image/png" : "image/jpeg";
  const extension = keepsAlpha ? ".png" : ".jpg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.85));
  if (!blob) return file;
  // A re-encoded PNG can come out larger than the original — a photo saved as
  // PNG, for instance. Keeping whichever is smaller means the downscale never
  // makes the upload worse.
  if (blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/u, extension), { type: mime });
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
    return { ok: false, message: payload?.error?.message ?? "The upload could not be completed. Try again." };
  }
  return { ok: true, data: payload.data, message: "" };
}

/**
 * The browser derives Content-Length from the File body and forbids JavaScript
 * from setting it, so filter it out of whatever the presign response
 * advertises — calling setRequestHeader would otherwise log a console error.
 *
 * It is not signed into the presigned URL either, despite what this comment
 * used to say: see the note on `createUpload` in `shared/server/r2.ts` for what
 * does enforce the declared size.
 */
export function browserSettableUploadHeaders(headers: Record<string, string>): Array<[string, string]> {
  return Object.entries(headers).filter(([name]) => name.toLowerCase() !== "content-length");
}

/** XHR rather than fetch: only XHR reports upload progress. */
function putWithProgress(url: string, file: File, headers: Record<string, string>, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of browserSettableUploadHeaders(headers)) request.setRequestHeader(name, value);
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
  associationFinalizes = false,
}: {
  eventId: string;
  kind: FileKind;
  onUploaded: (fileId: string, meta: UploadedMeta) => boolean | void | Promise<boolean | void>;
  accept?: string;
  maxSizeMb?: number;
  currentFileId?: string | null;
  fileRequestId?: string;
  label?: string;
  /**
   * The caller's own endpoint finalizes this upload, so skip the separate
   * `/api/uploads/finalize` round trip and hand `onUploaded` the *staged* fileId.
   *
   * This exists to make a two-step flow atomic. Finalizing here and associating
   * there means a lost second request leaves bytes published under an immutable
   * key with nothing pointing at them and no one told — the speaker-portal file
   * task's original defect (#621). Deferring it means an association that never
   * arrives leaves the object in `staging/`, which the daily sweep already owns,
   * and leaves the caller's own record honestly untouched.
   *
   * Only set it when the association endpoint really does finalize: a caller
   * that stores this fileId without finalizing is storing an unverified upload
   * that no download path will ever serve.
   */
  associationFinalizes?: boolean;
}) {
  const policy = CLIENT_POLICY[kind];
  const limitMb = maxSizeMb ?? policy.maxSizeMb;
  const [phase, setPhase] = useState<Phase>(currentFileId ? "done" : "idle");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState<{ fileId: string; meta: UploadedMeta } | null>(null);
  const [pendingAssociation, setPendingAssociation] = useState<{ fileId: string; meta: UploadedMeta } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function fail(reason: string) {
    setError(reason);
    setPhase("error");
  }

  // "uploaded, but could not be saved" is only true when this component already
  // published the bytes. When the association endpoint finalizes, a refusal may
  // equally mean it rejected what landed and deleted it, so the copy stops
  // claiming the file is safely stored — the caller's own toast carries the
  // server's reason either way.
  const associationFailed = associationFinalizes
    ? "That did not go through. Try again, or choose another file."
    : "The file uploaded, but could not be saved. Try again.";

  async function associate(fileId: string, meta: UploadedMeta) {
    setPhase("associating");
    try {
      const accepted = await onUploaded(fileId, meta);
      if (accepted === false) throw new Error(associationFailed);
      setPendingAssociation(null);
      setUploaded({ fileId, meta });
      setPhase("done");
    } catch (associationError) {
      setPendingAssociation({ fileId, meta });
      fail(associationError instanceof Error ? associationError.message : associationFailed);
    }
  }

  async function upload(picked: File) {
    // Choosing another file abandons any replacement that uploaded but failed
    // to associate. Its retry must never survive into this new attempt.
    setPendingAssociation(null);
    setError("");
    setPhase("validating");

    // Downscale first, then check the size — the server's policy is applied to
    // `sizeBytes`, which is the *post*-downscale number this sends at presign.
    // Checking `picked` rejected images the server would have accepted: an
    // ordinary 12 MP phone photo (~6 MB) is exactly the case `downscale` exists
    // for, and it would have arrived as a couple of hundred KB, but the upload
    // was refused with "That file is 6.0 MB — the limit is 5 MB" — a limit that
    // would never have applied to what was actually going to be uploaded.
    let file = picked;
    if (policy.downscaleTo) {
      setPhase("downscaling");
      file = await downscale(picked, policy.downscaleTo);
    }

    if (file.size > limitMb * 1024 * 1024) {
      fail(`That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is ${limitMb} MB.`);
      return;
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
    // rejection reason is the only honest thing to show. When the association
    // endpoint finalizes, that same check still runs — one request later, and on
    // the far side of the network hop that used to be able to strand a published
    // file with nothing pointing at it.
    if (!associationFinalizes) {
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
    }

    const meta: UploadedMeta = { filename: file.name, sizeBytes: file.size, mime: file.type };
    await associate(fileId, meta);
  }

  const busy = phase === "validating" || phase === "downscaling" || phase === "presigning" || phase === "uploading" || phase === "finalizing" || phase === "associating";
  const shownFileId = uploaded?.fileId ?? currentFileId ?? null;

  function chooseAnotherFile() {
    // A cancelled picker emits no change event, so preserve the current error
    // and any retryable association until upload() receives an actual file.
    inputRef.current?.click();
  }

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

      {shownFileId ? (
        <div className="file-upload__done">
          {/* Immutable by construction: a replacement always mints a new fileId,
              which is what makes this URL cacheable forever. */}
          <PrivateFileLink fileId={shownFileId}>{uploaded?.meta.filename ?? "Current file"}</PrivateFileLink>
          {/* A cancelled native picker emits no change event. Keep the current
              file visible until the user actually chooses a replacement. */}
          <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={busy || phase === "error"}>
            {busy ? PHASE_LABEL[phase] : "Replace"}
          </Button>
        </div>
      ) : (
        <button type="button" className="file-upload__drop" onClick={() => inputRef.current?.click()} disabled={busy || phase === "error"}>
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
          {pendingAssociation ? (
            <>
              <button type="button" onClick={() => void associate(pendingAssociation.fileId, pendingAssociation.meta)}>Try saving again</button>
              <span>or</span>
              <button type="button" onClick={chooseAnotherFile}>Choose another file</button>
            </>
          ) : (
            <button type="button" onClick={chooseAnotherFile}>{shownFileId ? "Choose another file" : "Try again"}</button>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * A file the browser reads locally — the CSV importers parse the bytes in the
 * page and never touch R2, so `FileUpload` above (presign → PUT → finalize) is
 * the wrong primitive for them. What they do share is the chrome: a hidden
 * native input driven by the designed dropzone, which is what keeps the OS
 * "Choose File / No file chosen" widget off a dialog full of kit controls.
 */
export function LocalFilePicker({ accept, label, hint, disabled, inputRef, onPick }: {
  accept: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File) => void;
}) {
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;
  return (
    <div className="file-upload">
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          const picked = event.target.files?.[0];
          // Clearing first so re-picking the same file still fires a change.
          event.target.value = "";
          if (picked) onPick(picked);
        }}
      />
      <button type="button" className="file-upload__drop" disabled={disabled} onClick={() => ref.current?.click()}>
        <Upload size={18} />
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </button>
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
  associating: "Saving…",
  done: "",
  error: "",
};
