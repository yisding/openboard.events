"use client";

import Link from "next/link";
import { Copy, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormAvailability } from "@/features/forms/lib/form-open";
import { copyText, type ClipboardWriter, type CopyFallback } from "@/shared/ui/app/copy-text";
import { useToast } from "@/shared/ui/toast";

const AVAILABILITY_GUIDANCE: Record<Exclude<FormAvailability, "live">, string> = {
  draft: "Draft — this form is not public yet.",
  scheduled: "Scheduled — the public form is not open yet.",
  ended: "The submission window has ended.",
  closed: "This form was closed manually.",
};

export async function copyPublicFormLink(
  path: string,
  origin: string,
  clipboard?: ClipboardWriter | null,
  fallback?: CopyFallback,
): Promise<boolean> {
  return copyText(new URL(path, origin).toString(), clipboard, fallback);
}

export function SavedFormActions({
  availability,
  eventSlug,
  formId,
  formName,
  previewHref,
  compact = false,
}: {
  availability: FormAvailability;
  eventSlug: string;
  formId: string;
  formName: string;
  /** Omit on the preview page, where unavailable states need guidance instead. */
  previewHref?: string;
  compact?: boolean;
}) {
  const { toast } = useToast();
  const [manualUrl, setManualUrl] = useState("");
  const manualInputRef = useRef<HTMLInputElement>(null);
  const publicPath = `/submit/${eventSlug}/${formId}`;
  const sizeClass = compact ? " button-sm" : "";

  useEffect(() => {
    if (!manualUrl) return;
    manualInputRef.current?.focus();
    manualInputRef.current?.select();
  }, [manualUrl]);

  async function copyLink() {
    const origin = window.location.origin;
    const value = new URL(publicPath, origin).toString();
    const copied = await copyPublicFormLink(publicPath, origin);
    if (copied) {
      setManualUrl("");
      toast("Public submission link copied");
      return;
    }
    setManualUrl(value);
    toast("Link selected — press Cmd/Ctrl+C to copy", { kind: "error" });
  }

  if (availability !== "live") {
    return previewHref ? (
      <Link
        className={`button button-secondary${sizeClass}`}
        href={previewHref}
        target="_blank"
        rel="noreferrer"
        aria-label={`Preview form: ${formName} (opens in a new tab)`}
      >
        Preview
      </Link>
    ) : <span className="saved-form-availability" role="status">{AVAILABILITY_GUIDANCE[availability]}</span>;
  }

  return (
    <>
      <Link
        className={`button button-secondary${sizeClass}`}
        href={publicPath}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open live form: ${formName} (opens in a new tab)`}
      >
        Open live form <ExternalLink size={compact ? 14 : 16} />
      </Link>
      <button
        className={`button button-secondary${sizeClass}`}
        type="button"
        aria-label={`Copy public link: ${formName}`}
        onClick={() => void copyLink()}
      >
        <Copy size={compact ? 14 : 16} /> Copy link
      </button>
      {manualUrl && (
        <input
          ref={manualInputRef}
          className="saved-form-copy-fallback"
          aria-label={`Public submission link for ${formName}`}
          readOnly
          value={manualUrl}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </>
  );
}
