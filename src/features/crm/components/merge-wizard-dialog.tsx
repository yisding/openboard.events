"use client";

import { ArrowLeftRight, GitMerge, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  crmMergeAuditDtoSchema,
  crmMergeAuditDetailDtoSchema,
  crmMergePreviewDtoSchema,
  type CrmMergeId,
  type CrmMergePreviewDTO,
  type OrganizationContactId,
  type OrganizationId,
} from "@/shared/contracts";
import { Button, Modal } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name", lastName: "Last name", company: "Company", jobTitle: "Job title",
  bioHtml: "Bio", linkedinUrl: "LinkedIn", twitterUrl: "Twitter/X", websiteUrl: "Website",
};

type Candidate = { id: OrganizationContactId; label: string; email: string };
type Resolution = "primary" | "merged";

/**
 * M55 — the merge wizard (guardrail: "requires preview, explicit primary,
 * reference counts, audit trail … before committing"). Pick/swap the primary
 * → server preview with reference counts and field conflicts → per-field
 * keep-primary/take-merged resolution → the audited commit. Because the
 * commit writes an immutable before-merge snapshot, the confirmation step
 * offers a one-click "Undo merge" that calls the recovery endpoint and fully
 * restores the tombstoned contact. The confirming button reads "Merge" only
 * after the reference counts have rendered — never a same-click default.
 */
export function MergeWizardDialog({
  organizationId,
  open,
  onClose,
  a,
  b,
}: {
  organizationId: OrganizationId;
  open: boolean;
  onClose: () => void;
  a: Candidate;
  b: Candidate;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [swapped, setSwapped] = useState(false);
  const [preview, setPreview] = useState<CrmMergePreviewDTO | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [mergeId, setMergeId] = useState<CrmMergeId | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recovered, setRecovered] = useState(false);

  const primary = swapped ? b : a;
  const merged = swapped ? a : b;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);
    setResolutions({});
    api(`organizations/${organizationId}/crm/merge/preview`, crmMergePreviewDtoSchema, {
      method: "POST",
      body: { primaryContactId: primary.id, mergedContactId: merged.id },
    })
      .then((result) => { if (!cancelled) setPreview(result); })
      .catch((caught) => { if (!cancelled) setError(isAppError(caught) ? caught.message : "Could not preview this merge"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, organizationId, primary.id, merged.id]);

  function reset() {
    setSwapped(false); setPreview(null); setResolutions({}); setError(null); setDone(false);
    setMergeId(null); setRecovering(false); setRecovered(false);
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const audit = await api(`organizations/${organizationId}/crm/merge`, crmMergeAuditDtoSchema, {
        method: "POST",
        body: { primaryContactId: primary.id, mergedContactId: merged.id, fieldResolutions: resolutions },
      });
      setMergeId(audit.id);
      setDone(true);
      toast(`Merged into ${primary.label}`);
      router.refresh();
    } catch (caught) {
      setError(isAppError(caught) ? caught.message : "That merge did not go through");
    } finally {
      setBusy(false);
    }
  }

  async function recover() {
    if (!mergeId || recovering) return;
    setRecovering(true);
    setError(null);
    try {
      await api(`organizations/${organizationId}/crm/merge/${mergeId}/recover`, crmMergeAuditDetailDtoSchema, { method: "POST" });
      setRecovered(true);
      toast(`Restored ${merged.label}`);
      router.refresh();
    } catch (caught) {
      setError(isAppError(caught) ? caught.message : "That merge could not be recovered");
    } finally {
      setRecovering(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Merge duplicate contacts"
      description="The primary stays; the other is tombstoned and every reference reassigned. It can be undone from the confirmation step."
      wide
      footer={done ? (
        <>
          {!recovered && <Button variant="secondary" disabled={recovering} onClick={() => void recover()}><Undo2 size={15} /> {recovering ? "Undoing…" : "Undo merge"}</Button>}
          <Button onClick={() => { reset(); onClose(); }}>Done</Button>
        </>
      ) : (
        <>
          <Button variant="secondary" onClick={() => { reset(); onClose(); }} disabled={busy}>Cancel</Button>
          <Button variant="danger" disabled={!preview || busy || loading} onClick={() => void commit()}>{busy ? "Merging…" : `Merge into ${primary.label}`}</Button>
        </>
      )}
    >
      {done ? (
        <div className="form-stack">
          <div className="notify-bar">
            {recovered ? (
              <div><Undo2 size={18} /><p><b>{merged.label} restored</b><small>The merge was reversed and {merged.label} is a separate contact again.</small></p></div>
            ) : (
              <div><GitMerge size={18} /><p><b>{merged.label} merged into {primary.label}</b><small>An audit record was written with the before-merge field snapshot and reference counts. Undo merge reverses it while it is still recoverable.</small></p></div>
            )}
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      ) : (
        <div className="form-stack">
          <div className="crm-merge-picker">
            <div style={{ textAlign: "center" }}><b>{primary.label}</b><small style={{ display: "block", color: "var(--muted)" }}>{primary.email}</small><span className="chip" style={{ marginTop: 6, display: "inline-block" }}>Primary — kept</span></div>
            <Button variant="ghost" size="sm" onClick={() => setSwapped((current) => !current)} aria-label="Swap primary and merged"><ArrowLeftRight size={16} /></Button>
            <div style={{ textAlign: "center" }}><b>{merged.label}</b><small style={{ display: "block", color: "var(--muted)" }}>{merged.email}</small><span className="chip" style={{ marginTop: 6, display: "inline-block" }}>Merged — tombstoned</span></div>
          </div>

          {loading && <p className="long-copy">Loading preview…</p>}
          {error && <p className="field-error" role="alert">{error}</p>}

          {preview && (
            <>
              <div className="crm-merge-refs">
                <div><b>{preview.referenceCounts.eventLinks}</b><span>Event links</span></div>
                <div><b>{preview.referenceCounts.tags}</b><span>Tags</span></div>
                <div><b>{preview.referenceCounts.notes}</b><span>Notes</span></div>
                <div><b>{preview.referenceCounts.activity}</b><span>Activity</span></div>
                <div><b>{preview.referenceCounts.pipelineEntries}</b><span>Pipeline entries</span></div>
              </div>

              {preview.fieldConflicts.length === 0 ? (
                <p className="long-copy">No conflicting fields — every field the merged contact has is either blank or already matches the primary.</p>
              ) : (
                <div className="crm-merge-compare">
                  <div className="crm-merge-column-head">Field</div><div className="crm-merge-column-head">Keep primary</div><div className="crm-merge-column-head">Take merged</div>
                  {preview.fieldConflicts.map((conflict) => {
                    const resolution = resolutions[conflict.field] ?? "primary";
                    return (
                      <div key={conflict.field} className="crm-merge-conflict">
                        <div className="crm-merge-field-label">{FIELD_LABELS[conflict.field] ?? conflict.field}</div>
                        <div className="crm-merge-choice">
                          <label>
                            <input type="radio" name={`field-${conflict.field}`} checked={resolution === "primary"} onChange={() => setResolutions((current) => ({ ...current, [conflict.field]: "primary" }))} />
                            <span><small>Keep primary</small>{conflict.primaryValue || <em style={{ color: "var(--muted)" }}>blank</em>}</span>
                          </label>
                        </div>
                        <div className="crm-merge-choice">
                          <label>
                            <input type="radio" name={`field-${conflict.field}`} checked={resolution === "merged"} onChange={() => setResolutions((current) => ({ ...current, [conflict.field]: "merged" }))} />
                            <span><small>Take merged</small>{conflict.mergedValue}</span>
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
