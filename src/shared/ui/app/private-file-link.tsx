"use client";

import React, { useState } from "react";

/** Private attachments are opened through a short-lived, authorized R2 URL. */
export function PrivateFileLink({ fileId, children = "Uploaded file" }: { fileId: string; children?: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function open() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/uploads/${encodeURIComponent(fileId)}/download-url`);
      const payload = await response.json().catch(() => null) as {
        data?: { url?: string };
        error?: { message?: string };
      } | null;
      const url = payload?.data?.url;
      if (!response.ok || !url) {
        setError(payload?.error?.message ?? "The file could not be opened");
        return;
      }
      window.location.assign(url);
    } catch {
      setError("The file could not be opened — check your connection and try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="private-file-link">
      <button type="button" className="text-button" onClick={() => void open()} disabled={busy}>
        {busy ? "Opening…" : children}
      </button>
      {error && <small role="alert">{error}</small>}
    </span>
  );
}
