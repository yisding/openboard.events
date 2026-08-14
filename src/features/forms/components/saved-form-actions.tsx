"use client";

import Link from "next/link";
import { Copy, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formAvailability, type FormAvailability, type FormOpenStatus } from "../lib/form-open";
import { copyText, type ClipboardWriter, type CopyFallback } from "@/shared/ui/app/copy-text";
import { Button } from "@/shared/ui/ui-kit";
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

export function nextFormAvailabilityRefreshMs(
  form: { status: FormOpenStatus; opensAt: string | null; closesAt: string | null },
  nowMs: number,
): number | null {
  if (form.status !== "open") return null;
  const futureBoundaries = [form.opensAt, form.closesAt]
    .filter((value): value is string => value !== null)
    .map((value) => new Date(value).getTime())
    .filter((value) => value > nowMs);
  if (futureBoundaries.length === 0) return null;
  // Recheck just after the SQL boundary: opens_at equality is open, while
  // closes_at equality is closed. Long schedules are revisited at the maximum
  // browser timeout until their actual boundary is close enough.
  return Math.min(Math.min(...futureBoundaries) - nowMs + 25, 2_147_483_647);
}

export function SavedFormActions({
  availability,
  eventSlug,
  formId,
  formName,
  status,
  opensAt,
  closesAt,
  previewHref,
  compact = false,
}: {
  availability: FormAvailability;
  eventSlug: string;
  formId: string;
  formName: string;
  status: FormOpenStatus;
  opensAt: string | null;
  closesAt: string | null;
  /** Omit on the preview page, where unavailable states need guidance instead. */
  previewHref?: string;
  compact?: boolean;
}) {
  const { toast } = useToast();
  const [currentAvailability, setCurrentAvailability] = useState(availability);
  const [manualUrl, setManualUrl] = useState("");
  const manualInputRef = useRef<HTMLInputElement>(null);
  const publicPath = `/submit/${eventSlug}/${formId}`;
  const sizeClass = compact ? " button-sm" : "";

  useEffect(() => {
    let timer: number | null = null;
    const refresh = () => {
      const nowMs = Date.now();
      setCurrentAvailability(formAvailability({ status, opensAt, closesAt }, new Date(nowMs).toISOString()));
      const delay = nextFormAvailabilityRefreshMs({ status, opensAt, closesAt }, nowMs);
      if (delay !== null) timer = window.setTimeout(refresh, delay);
    };
    refresh();
    return () => { if (timer !== null) window.clearTimeout(timer); };
  }, [closesAt, opensAt, status]);

  useEffect(() => {
    if (!manualUrl) return;
    manualInputRef.current?.focus();
    manualInputRef.current?.select();
  }, [manualUrl]);

  async function copyLink() {
    const clickedAvailability = formAvailability({ status, opensAt, closesAt }, new Date().toISOString());
    if (clickedAvailability !== "live") {
      setCurrentAvailability(clickedAvailability);
      toast("This form is no longer live. Review its availability before sharing it.", { kind: "error" });
      return;
    }
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

  if (currentAvailability !== "live") {
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
    ) : <span className="saved-form-availability" role="status">{AVAILABILITY_GUIDANCE[currentAvailability]}</span>;
  }

  return (
    <>
      <Link
        className={`button button-secondary${sizeClass}`}
        href={publicPath}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open live form: ${formName} (opens in a new tab)`}
        onClick={(event) => {
          const clickedAvailability = formAvailability({ status, opensAt, closesAt }, new Date().toISOString());
          if (clickedAvailability === "live") return;
          event.preventDefault();
          setCurrentAvailability(clickedAvailability);
          toast("This form is no longer live. Review its availability before opening it.", { kind: "error" });
        }}
      >
        Open live form <ExternalLink size={compact ? 14 : 16} />
      </Link>
      <Button
        variant="secondary"
        size={compact ? "sm" : "md"}
        aria-label={`Copy public link: ${formName}`}
        onClick={() => void copyLink()}
      >
        <Copy size={compact ? 14 : 16} /> Copy link
      </Button>
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
