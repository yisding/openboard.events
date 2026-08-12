"use client";

import Link from "next/link";
import { ArrowRight, Clock3, Copy, ExternalLink, FilePlus2, Rocket, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/shared/ui/toast";
import { formatInZone } from "@/shared/lib/time";
import type { DashboardOverview } from "../index";

type DashboardForm = DashboardOverview["forms"][number];

export type ActivationState =
  | { kind: "no_form" }
  | { kind: "draft"; form: DashboardForm }
  | { kind: "closed"; form: DashboardForm }
  | { kind: "scheduled"; form: DashboardForm }
  | { kind: "ended"; form: DashboardForm }
  | { kind: "live"; form: DashboardForm }
  | null;

/**
 * Keep one concrete launch job above the dashboard until the event receives
 * its first submitted proposal. An open form is the most useful form to lead
 * with when an event has more than one.
 */
export function resolveActivationState(overview: DashboardOverview): ActivationState {
  if (overview.kpis.submissions > 0) return null;
  if (overview.forms.length === 0) return { kind: "no_form" };

  const live = overview.forms.find((form) => form.availability === "live");
  if (live) return { kind: "live", form: live };

  const scheduled = overview.forms.find((form) => form.availability === "scheduled");
  if (scheduled) return { kind: "scheduled", form: scheduled };

  const draft = overview.forms.find((form) => form.availability === "draft");
  if (draft) return { kind: "draft", form: draft };

  const ended = overview.forms.find((form) => form.availability === "ended");
  if (ended) return { kind: "ended", form: ended };

  const [closed] = overview.forms;
  return closed ? { kind: "closed", form: closed } : { kind: "no_form" };
}

function CopyablePublicLink({ path }: { path: string }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [publicUrl, setPublicUrl] = useState(path);

  useEffect(() => {
    setPublicUrl(new URL(path, window.location.origin).toString());
  }, [path]);

  async function copyLink() {
    const value = new URL(path, window.location.origin).toString();
    setPublicUrl(value);

    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(value);
      toast("Public submission link copied");
      return;
    } catch {
      const input = inputRef.current;
      if (input) {
        // Keep the field useful even if the effect has not run yet, then leave
        // the full value selected for a manual Cmd/Ctrl+C fallback.
        input.value = value;
        input.focus();
        input.select();
      }

      let copied = false;
      try {
        copied = Boolean(input && document.execCommand("copy"));
      } catch {
        // Selection is the final, browser-independent fallback.
      }

      toast(copied ? "Public submission link copied" : "Link selected — press Cmd/Ctrl+C to copy", copied ? undefined : { kind: "error" });
    }
  }

  return (
    <div className="dashboard-activation-share">
      <label className="sr-only" htmlFor="dashboard-public-submission-link">Public submission link</label>
      <input
        id="dashboard-public-submission-link"
        ref={inputRef}
        readOnly
        value={publicUrl}
        onFocus={(event) => event.currentTarget.select()}
      />
      <button className="button button-primary" type="button" onClick={() => void copyLink()}><Copy size={15} /> Copy link</button>
    </div>
  );
}

export function ActivationGuide({ overview }: { overview: DashboardOverview }) {
  const state = resolveActivationState(overview);
  if (!state) return null;

  const formsHref = `/events/${overview.event.id}/forms`;
  const formHref = state.kind === "no_form" ? formsHref : `${formsHref}/${state.form.formId}`;

  let icon = <Rocket size={18} />;
  let title = "Get your first submission";
  let description = "Your call for speakers is live. Preview the speaker experience, then share this link with your community.";
  let action = "Manage form";

  if (state.kind === "no_form") {
    icon = <FilePlus2 size={18} />;
    title = "Create your call for speakers";
    description = "Build and publish a submission form so speakers have a clear place to send their proposals.";
    action = "Create form";
  } else if (state.kind === "draft") {
    title = "Publish your call for speakers";
    description = `${state.form.name} is saved as a draft. Review it, then publish it to start accepting proposals.`;
    action = "Finish and publish";
  } else if (state.kind === "scheduled") {
    icon = <Clock3 size={18} />;
    title = "Your call for speakers is scheduled";
    description = state.form.opensAt
      ? `${state.form.name} opens ${formatInZone(state.form.opensAt, overview.event.timezone, "long")}. Review the timing before you announce it.`
      : `${state.form.name} is scheduled to open later. Review the timing before you announce it.`;
    action = "Review timing";
  } else if (state.kind === "ended") {
    icon = <RotateCcw size={18} />;
    title = "Extend your submission window";
    description = state.form.closesAt
      ? `${state.form.name} closed ${formatInZone(state.form.closesAt, overview.event.timezone, "long")} before its first proposal arrived.`
      : `${state.form.name} closed before its first proposal arrived.`;
    action = "Update dates";
  } else if (state.kind === "closed") {
    icon = <RotateCcw size={18} />;
    title = "Reopen your call for speakers";
    description = `${state.form.name} is closed and has not received a proposal yet. Reopen it when you are ready to collect submissions.`;
    action = "Manage form";
  }

  return (
    <section className="dashboard-activation" aria-labelledby="dashboard-activation-title">
      <span className="dashboard-activation-icon" aria-hidden>{icon}</span>
      <div className="dashboard-activation-content">
        <span className="dashboard-activation-eyebrow">Launch guide · next step</span>
        <h2 id="dashboard-activation-title">{title}</h2>
        <p>{description}</p>
        {state.kind === "live" ? (
          <>
            <CopyablePublicLink path={`/submit/${overview.event.slug}/${state.form.formId}`} />
            <div className="dashboard-activation-actions">
              <Link className="button button-secondary" href={`/events/${overview.event.id}/forms/${state.form.formId}/preview`} target="_blank" rel="noreferrer">Preview form <ExternalLink size={15} /></Link>
              <Link className="dashboard-activation-manage" href={formHref}>Manage form <ArrowRight size={14} /></Link>
            </div>
          </>
        ) : (
          <div className="dashboard-activation-actions">
            <Link className="button button-primary" href={formHref}>{action} <ArrowRight size={15} /></Link>
          </div>
        )}
      </div>
    </section>
  );
}
