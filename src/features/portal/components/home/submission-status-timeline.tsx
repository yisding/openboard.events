import { Check } from "lucide-react";
import type { PortalStatus } from "@/features/portal";

/**
 * M59 — "A 'what happens next' timeline. Submitted ✓ → In review → Decision"
 * (experience-design.md). Compact by design (three dots, not a full page
 * section) so it fits inline on every submission row rather than competing
 * for space with the hero — the admin-density principle applies here too:
 * hierarchy through the type ramp, not another card.
 */
const DECIDED: readonly PortalStatus[] = ["Accepted", "Declined", "Withdrawn"];

function decisionLabel(status: PortalStatus): string {
  if (status === "Accepted") return "Accepted";
  if (status === "Declined") return "Declined";
  if (status === "Withdrawn") return "Withdrawn";
  return "Decision";
}

export function SubmissionStatusTimeline({ status }: { status: PortalStatus }) {
  if (status === "Draft") return null;
  const decided = DECIDED.includes(status);
  const steps = [
    { label: "Submitted", done: true, current: false },
    { label: "In review", done: decided, current: !decided },
    { label: decisionLabel(status), done: decided, current: false },
  ];
  return (
    <ol className="submission-timeline" aria-label="Submission status">
      {steps.map((step) => (
        <li key={step.label} className={step.done ? "done" : step.current ? "current" : ""} aria-current={step.current ? "step" : undefined}>
          <span>{step.done ? <Check size={9} /> : null}</span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}
