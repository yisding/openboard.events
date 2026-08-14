"use client";

import { CreditCard, Gauge, Info } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import type { BillingPlanDTO, MemberRole, OrganizationBillingSummaryDTO, OrganizationId } from "@/shared/contracts";
import { Button, ProgressBar, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";

function formatPrice(priceCents: number | null): string {
  if (priceCents === null) return "Custom pricing";
  if (priceCents === 0) return "Free";
  return `$${(priceCents / 100).toFixed(0)}/mo`;
}

/**
 * M49 — the billing settings surface: current plan, subscription status, and
 * usage against the plan's limits, plus the plan catalog to change to.
 *
 * There is no live payment provider (`@/features/billing/server/provider.ts`'s
 * header comment) — "Choose plan" goes through the real checkout endpoint,
 * so the seam is genuinely exercised, and the stub adapter's `VALIDATION`
 * error surfaces as the toast rather than a fabricated success. That is
 * deliberate: a scaffold that pretended a plan change worked would be worse
 * than one that visibly says it can't yet.
 */
export function BillingPanel({
  organizationId,
  currentRole,
  summary,
  plans,
}: {
  organizationId: OrganizationId;
  currentRole: MemberRole;
  summary: OrganizationBillingSummaryDTO;
  plans: BillingPlanDTO[];
}) {
  const { toast } = useToast();
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const canManage = currentRole === "owner";
  const { plan, subscription, usage, counters } = summary;
  const usagePercent = usage.events.limit === null ? 0 : Math.round((usage.events.used / usage.events.limit) * 100);
  const usageTone = usagePercent >= 100 ? "amber" : "accent";

  async function choosePlan(target: BillingPlanDTO) {
    if (!canManage || target.id === plan.id) return;
    setPendingPlanId(target.id);
    try {
      await api(`organizations/${organizationId}/billing/checkout`, z.object({ url: z.string() }), {
        method: "POST",
        body: { planId: target.id },
      });
      toast(`Redirecting to checkout for ${target.name}…`);
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "That plan change did not start");
    } finally {
      setPendingPlanId(null);
    }
  }

  return <>
    <section className="panel settings-section">
      <header>
        <h2><CreditCard size={16} /> Current plan</h2>
        <p>What this organization is subscribed to and how it&apos;s billed.</p>
      </header>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 20 }}>{plan.name}</strong>
        <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{formatPrice(plan.priceCents)}</span>
        <StatusBadge value={subscription.status} />
        <span style={{ color: "var(--muted)", fontSize: 12.5 }}>via {subscription.provider}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, color: "var(--muted)", fontSize: 12.5 }}>
        <Info size={13} /> No live payment provider is connected in this environment — this is a billing scaffold. Choosing a plan below attempts a real checkout through the provider seam and will explain why it isn&apos;t available yet.
      </div>
    </section>

    <section className="panel settings-section">
      <header>
        <h2><Gauge size={16} /> Usage</h2>
        <p>Metered against this organization&apos;s plan.</p>
      </header>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>
          <span>Events</span>
          <span>{usage.events.used} of {usage.events.limit ?? "∞"} used</span>
        </div>
        <ProgressBar label="Event usage" value={usage.events.limit === null ? 0 : usagePercent} tone={usageTone} />
      </div>
      {counters.length > 0 && <ul style={{ marginTop: 16, display: "grid", gap: 4, fontSize: 12.5, color: "var(--muted)" }}>
        {counters.map((counter) => <li key={counter.metric}>{counter.metric}: {counter.count}</li>)}
      </ul>}
    </section>

    <section className="panel settings-section">
      <header>
        <h2>Plans</h2>
        <p>{canManage ? "Change this organization's plan." : "Only an owner can change the plan."}</p>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {plans.map((candidate) => {
          const isCurrent = candidate.id === plan.id;
          return <div key={candidate.id} style={{ border: `1px solid ${isCurrent ? "var(--accent-border)" : "var(--line)"}`, borderRadius: 11, padding: 16, background: isCurrent ? "var(--accent-faint)" : "var(--surface)" }}>
            <strong>{candidate.name}</strong>
            <p style={{ margin: "4px 0 12px", color: "var(--muted)", fontSize: 12.5 }}>{formatPrice(candidate.priceCents)} · {candidate.maxEvents === null ? "Unlimited" : candidate.maxEvents} events</p>
            {isCurrent
              ? <StatusBadge value="current_plan" />
              : canManage
                ? <Button size="sm" variant="secondary" onClick={() => void choosePlan(candidate)} disabled={pendingPlanId !== null}>
                    {pendingPlanId === candidate.id ? "Starting…" : "Choose plan"}
                  </Button>
                : null}
          </div>;
        })}
      </div>
    </section>
  </>;
}
