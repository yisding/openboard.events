"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AlertTriangle,
  Bell,
  Check,
  CircleCheck,
  CircleStop,
  Copy,
  Eye,
  FileText,
  LockKeyhole,
  MessageSquareText,
  Plus,
  Rocket,
  Save,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import type { FieldType, MapsToTarget, ReviewVisibility } from "@/shared/contracts";
import {
  apiErrorSchema,
  COMMITTED_FIELD_TYPES,
  eventIdSchema,
  formContextSchema,
  formIdSchema,
  formStatusSchema,
  MAPS_TO_TARGETS,
  sectionIdSchema,
  taskTargetSchema,
} from "@/shared/contracts";
import { AppError, isAppError } from "@/shared/lib/errors";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { copyText } from "@/shared/ui/app/copy-text";
import { requestGuardedEditorClose } from "@/shared/ui/app/modal-editor-guard";
import { useGuardedAction, useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { Button, Field, Modal, Select, StatusBadge, Switch } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { BUILDER_STEPS, type BuilderEvent, type BuilderField, type BuilderForm, type BuilderSection, type BuilderStep, type FormPatch } from "./builder-types";
import { mergeUnsavedBuilderEdits, tryCompileBuilderSnapshot, type BuilderDirtyTarget } from "./form-builder-state";
import { formAvailability, formAvailabilityActionCopy, formAvailabilityActionLabel, type FormAvailabilityAction } from "./lib/form-open";
// M13b: the visibility editor, live preview, and routing panel are that
// module's — this file only mounts them at the right point in the wizard.
import { BuilderPreview as LiveBuilderPreview } from "./components/builder/builder-preview";
import { RoutingRulesPanel } from "./components/builder/routing-rules-panel";
import { VisibilityRuleEditor } from "./components/builder/visibility-rule-editor";
// M14: the Settings/Notifications steps are owned by that module — see
// components/builder/settings-step.tsx and notifications-step.tsx for the
// hardened deadline/capacity/confirmation-template implementations.
import { NotificationsStep } from "./components/builder/notifications-step";
import { SettingsStep } from "./components/builder/settings-step";
import { duplicateFormAsDraft, formDuplicateOutcomeUnknown } from "./duplicate-form";
import {
  normalizeParticipantStepRoles,
  participantStepOperationSchema,
  participantStepRolesSchema,
  type ParticipantStepOperation,
} from "./participant-step";

const stepMeta = [
  { id: "setup", label: "Setup", icon: Settings2 },
  { id: "welcome", label: "Welcome", icon: MessageSquareText },
  { id: "abstract", label: "Abstract", icon: FileText },
  { id: "participant", label: "Participant", icon: Users },
  { id: "settings", label: "Settings", icon: SlidersHorizontal },
  { id: "notifications", label: "Notifications", icon: Bell },
] as const;

const addableTypes: Array<{ type: (typeof COMMITTED_FIELD_TYPES)[number]; label: string; description: string }> = [
  { type: "text", label: "Short text", description: "A single line response" },
  { type: "textarea", label: "Long text", description: "A paragraph response" },
  { type: "richtext", label: "Rich text", description: "Formatted long-form answer" },
  { type: "dropdown", label: "Dropdown", description: "Choose one option" },
  { type: "multiselect", label: "Multi-select", description: "Choose several options" },
  { type: "email", label: "Email", description: "Validated email address" },
  { type: "url", label: "Website", description: "Validated web address" },
  { type: "file", label: "File upload", description: "PDF, slides, or document" },
];

export function withRequiredSpeakerRole(roles: BuilderForm["participantRoles"]): BuilderForm["participantRoles"] {
  return roles.map((role) => role.role === "speaker" && !role.enabled ? { ...role, enabled: true } : role);
}

async function requestData<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AppError("INTERNAL", `Unexpected API response (${response.status})`);
  }
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (parsed.success) {
      throw new AppError(
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.data,
        parsed.data.error.fieldErrors,
      );
    }
    throw new AppError("INTERNAL", `Unexpected API response (${response.status})`);
  }
  if (typeof payload !== "object" || payload === null || !("data" in payload)) {
    throw new AppError("INTERNAL", `Unexpected API response (${response.status})`);
  }
  return (payload as { data: T }).data;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export function formAvailabilityOutcomeUnknown(error: unknown): boolean {
  return !isAppError(error) || error.code === "INTERNAL";
}

export function formAvailabilityRecoveryMessage(action: FormAvailabilityAction): string {
  return `We couldn’t confirm whether this form was ${action === "open" ? "opened" : "closed"}. Restore your connection, then check the current status before retrying.`;
}

const formAvailabilityAuthoritySchema = z.object({
  id: formIdSchema,
  eventId: eventIdSchema,
  context: formContextSchema,
  targetType: taskTargetSchema.nullable(),
  status: formStatusSchema,
  opensAt: z.iso.datetime().nullable(),
  closesAt: z.iso.datetime().nullable(),
  currentVersion: z.int().positive(),
  updatedAt: z.iso.datetime(),
});
type FormAvailabilityRecovery = {
  action: FormAvailabilityAction;
  expectedUpdatedAt: string;
};

const participantStepAuthoritySchema = formAvailabilityAuthoritySchema.extend({
  participantRoles: participantStepRolesSchema,
  sections: z.array(z.object({
    id: sectionIdSchema,
    key: z.string(),
    title: z.string(),
    pageHeading: z.string(),
    descriptionHtml: z.string(),
    fields: z.array(z.unknown()),
  }).passthrough()),
}).passthrough();

type ParticipantStepRecovery = {
  operation: ParticipantStepOperation;
  savedRevisions: ReadonlyArray<readonly [BuilderDirtyTarget, number | undefined]>;
};

export const PARTICIPANT_STEP_RECOVERY_MESSAGE = "We couldn’t confirm whether the participant settings and copy were saved. Restore your connection, then confirm this exact save before trying to save the form again.";

/** Accept the full server form, then restore only editor targets still dirty locally. */
export function mergeFormAvailabilityAuthority(
  local: BuilderForm,
  server: BuilderForm,
  dirtyTargets: ReadonlySet<BuilderDirtyTarget>,
): BuilderForm {
  const authority = formAvailabilityAuthoritySchema.parse(server);
  if (local.id !== authority.id || local.eventId !== authority.eventId || local.context !== authority.context) {
    throw new AppError("INTERNAL", "The latest form status did not match this form");
  }
  const merged = mergeUnsavedBuilderEdits(server, local, dirtyTargets);
  return {
    ...merged,
    // A dirty Settings target contains the locally displayed prior status.
    // Never let that draft undo the causally confirmed lifecycle operation or
    // its identity/version baseline; subsequent saves must use the server CAS.
    id: authority.id,
    eventId: authority.eventId,
    context: authority.context,
    targetType: authority.targetType,
    status: authority.status,
    currentVersion: authority.currentVersion,
    updatedAt: authority.updatedAt,
  };
}

export function FormBuilder({ event, initialForm }: { event: BuilderEvent; initialForm: BuilderForm }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const requestedStep = searchParams.get("step");
  const step: BuilderStep = BUILDER_STEPS.includes(requestedStep as BuilderStep) ? requestedStep as BuilderStep : "abstract";
  const [form, setForm] = useState(initialForm);
  const [persistedAvailabilityInput, setPersistedAvailabilityInput] = useState(() => ({
    status: initialForm.status,
    opensAt: initialForm.opensAt,
    closesAt: initialForm.closesAt,
  }));
  const [availabilityNow, setAvailabilityNow] = useState(() => new Date().toISOString());
  const [selected, setSelected] = useState<{ sectionId: string; fieldId: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState<(typeof COMMITTED_FIELD_TYPES)[number]>("text");
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [availabilityAlert, setAvailabilityAlert] = useState<string | null>(null);
  const [availabilityRecovery, setAvailabilityRecovery] = useState<FormAvailabilityRecovery | null>(null);
  const [participantStepRecovery, setParticipantStepRecovery] = useState<ParticipantStepRecovery | null>(null);
  const [pendingAvailabilityAction, setPendingAvailabilityAction] = useState<FormAvailabilityAction | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BuilderField | null>(null);
  const [compactInspector, setCompactInspector] = useState(false);
  const dirtyRevisions = useRef(new Map<BuilderDirtyTarget, number>());
  const newQuestionDraftDirty = adding && (newLabel.trim().length > 0 || newType !== "text");
  const [routingDraftDirty, setRoutingDraftDirty] = useState(false);
  const hasUnsavedWork = dirty || newQuestionDraftDirty;
  const hasUnsavedBuilderTargets = hasUnsavedWork || routingDraftDirty || participantStepRecovery !== null;
  useUnsavedWorkGuard(hasUnsavedWork || participantStepRecovery !== null);
  const { runGuarded, allowNextNavigation } = useGuardedAction();
  const selectedField = useMemo(() => form.sections.flatMap((section) => section.fields).find((field) => field.id === selected?.fieldId) ?? null, [form.sections, selected]);
  const availability = formAvailability(persistedAvailabilityInput, availabilityNow);
  const availabilityActionLabel = formAvailabilityActionLabel(persistedAvailabilityInput.status, availability);
  // M13b's live preview compiles a snapshot from the in-memory (possibly
  // unsaved) draft, so a conditional field visibly appears/disappears as the
  // organizer edits it — no save round trip. Falls back to the mock preview
  // if the draft is momentarily uncompilable mid-edit.
  const liveSnapshot = useMemo(() => tryCompileBuilderSnapshot(form), [form]);

  // The desktop field editor lives in the right-hand inspector, which the
  // responsive layout deliberately hides once the canvas needs the full
  // width. Keep the same editor reachable there through a native-dialog
  // modal instead of maintaining a second, reduced mobile field form.
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1024px)");
    const sync = () => setCompactInspector(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  // Effective availability can change while this long-lived editor stays
  // mounted. Wake at the next opening/closing boundary so the badge and
  // lifecycle action never describe yesterday's state.
  useEffect(() => {
    if (persistedAvailabilityInput.status !== "open") return;
    const current = Date.now();
    const nextBoundary = [persistedAvailabilityInput.opensAt, persistedAvailabilityInput.closesAt]
      .map((instant) => instant ? Date.parse(instant) : Number.NaN)
      .filter((instant) => Number.isFinite(instant) && instant > current)
      .sort((left, right) => left - right)[0];
    if (nextBoundary === undefined) return;
    const timer = window.setTimeout(
      () => setAvailabilityNow(new Date().toISOString()),
      Math.min(nextBoundary - current + 50, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [availabilityNow, persistedAvailabilityInput.closesAt, persistedAvailabilityInput.opensAt, persistedAvailabilityInput.status]);

  function markDirty(target: BuilderDirtyTarget) {
    dirtyRevisions.current.set(target, (dirtyRevisions.current.get(target) ?? 0) + 1);
    setDirty(true);
  }

  function setStep(next: BuilderStep) {
    if (next === step) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("step", next);
    const destination = `${pathname}?${params.toString()}`;
    // This search-only navigation keeps the same FormBuilder mounted, so the
    // in-memory multi-step draft is preserved. Allow it through the global
    // route guard; leaving the builder still prompts while any target is dirty.
    const performStep = () => allowNextNavigation(() => {
      setSelected(null);
      router.push(destination, { scroll: false });
    }, { destination });
    if (routingDraftDirty) runGuarded(performStep);
    else performStep();
  }

  function closeAddQuestion() {
    requestGuardedEditorClose({
      busy,
      dirty: newQuestionDraftDirty,
      runGuarded,
      close: () => {
        setAdding(false);
        setNewLabel("");
        setNewType("text");
        if (!dirty && !routingDraftDirty) setAvailabilityAlert(null);
      },
    });
  }

  function handleRoutingDraftStateChange(next: boolean) {
    setRoutingDraftDirty(next);
    if (!next && !hasUnsavedWork) setAvailabilityAlert(null);
  }

  function applyLocal(patch: FormPatch) {
    setForm((current) => ({ ...current, ...patch }) as BuilderForm);
    markDirty(`step:${step}`);
  }

  function applySection(sectionId: string, patch: Partial<BuilderSection>) {
    setForm((current) => ({ ...current, sections: current.sections.map((section) => section.id === sectionId ? { ...section, ...patch } : section) }));
    markDirty(`section:${sectionId}`);
  }

  function applyField(fieldId: string, patch: Partial<BuilderField>) {
    setForm((current) => ({
      ...current,
      sections: current.sections.map((section) => ({ ...section, fields: section.fields.map((field) => field.id === fieldId ? { ...field, ...patch } : field) })),
    }));
    markDirty(`field:${fieldId}`);
  }

  async function run(action: () => Promise<BuilderForm>, success: string, savedTargets: BuilderDirtyTarget[] = []) {
    if (busy) return false;
    if (participantStepRecovery) {
      toast(PARTICIPANT_STEP_RECOVERY_MESSAGE, { kind: "error" });
      return false;
    }
    const savedRevisions = new Map(savedTargets.map((target) => [target, dirtyRevisions.current.get(target)]));
    setBusy(true);
    try {
      const next = await action();
      setPersistedAvailabilityInput({ status: next.status, opensAt: next.opensAt, closesAt: next.closesAt });
      setAvailabilityNow(new Date().toISOString());
      for (const [target, revision] of savedRevisions) {
        if (dirtyRevisions.current.get(target) === revision) dirtyRevisions.current.delete(target);
      }
      const remaining = new Set(dirtyRevisions.current.keys());
      setForm((current) => mergeUnsavedBuilderEdits(next, current, remaining));
      setDirty(remaining.size > 0);
      if (remaining.size === 0 && !newQuestionDraftDirty && !routingDraftDirty) setAvailabilityAlert(null);
      toast(success);
      router.refresh();
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : "The form could not be saved", { kind: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function patchForm(patch: FormPatch, source = form): Promise<BuilderForm> {
    return requestData(`/api/internal/forms/${form.id}?eventId=${event.id}`, json("PATCH", { expectedUpdatedAt: source.updatedAt, patch }));
  }

  function participantStepRequest(recovery: ParticipantStepRecovery, replay: boolean): Promise<BuilderForm> {
    return requestData<unknown>(`/api/internal/forms/${form.id}/participant-step?eventId=${event.id}`, json("PATCH", {
      ...recovery.operation,
      ...(replay ? { participantReplay: true } : {}),
    })).then((value) => {
      const authority = participantStepAuthoritySchema.parse(value);
      const section = authority.sections.find((candidate) => candidate.id === recovery.operation.sectionId);
      if (authority.id !== form.id
        || authority.eventId !== event.id
        || authority.context !== "cfp"
        || section?.key !== "participant") {
        throw new AppError("INTERNAL", "The saved participant step did not match this form");
      }
      return value as BuilderForm;
    });
  }

  function applyParticipantStepAuthority(next: BuilderForm, recovery: ParticipantStepRecovery) {
    for (const [target, revision] of recovery.savedRevisions) {
      if (dirtyRevisions.current.get(target) === revision) dirtyRevisions.current.delete(target);
    }
    const remaining = new Set(dirtyRevisions.current.keys());
    setPersistedAvailabilityInput({ status: next.status, opensAt: next.opensAt, closesAt: next.closesAt });
    setAvailabilityNow(new Date().toISOString());
    setForm((current) => mergeUnsavedBuilderEdits(next, current, remaining));
    setDirty(remaining.size > 0);
    if (remaining.size === 0 && !newQuestionDraftDirty && !routingDraftDirty) setAvailabilityAlert(null);
    setParticipantStepRecovery(null);
    router.refresh();
  }

  async function replayParticipantStep(recovery: ParticipantStepRecovery): Promise<boolean> {
    try {
      const next = await participantStepRequest(recovery, true);
      applyParticipantStepAuthority(next, recovery);
      toast("Participant step saved — confirmed from the completed request");
      return true;
    } catch (error) {
      if (!formAvailabilityOutcomeUnknown(error)) {
        setParticipantStepRecovery(null);
        if (isAppError(error)) toast(error.message, { kind: "error" });
        return false;
      }
      setParticipantStepRecovery(recovery);
      toast(PARTICIPANT_STEP_RECOVERY_MESSAGE, { kind: "error" });
      return false;
    }
  }

  async function saveParticipantStep(section: BuilderSection) {
    if (busy) return;
    if (participantStepRecovery) {
      toast(PARTICIPANT_STEP_RECOVERY_MESSAGE, { kind: "error" });
      return;
    }
    const targets: BuilderDirtyTarget[] = [`section:${section.id}`, "step:participant"];
    const recovery: ParticipantStepRecovery = {
      operation: participantStepOperationSchema.parse({
        operationId: crypto.randomUUID(),
        expectedUpdatedAt: form.updatedAt,
        sectionId: section.id,
        participantRoles: normalizeParticipantStepRoles(form.participantRoles),
        section: {
          title: section.title,
          pageHeading: section.pageHeading,
          descriptionHtml: section.descriptionHtml,
        },
      }),
      savedRevisions: targets.map((target) => [target, dirtyRevisions.current.get(target)] as const),
    };
    setBusy(true);
    try {
      try {
        const next = await participantStepRequest(recovery, false);
        applyParticipantStepAuthority(next, recovery);
        toast("Participant step saved");
      } catch (error) {
        if (formAvailabilityOutcomeUnknown(error)) await replayParticipantStep(recovery);
        else if (isAppError(error)) toast(error.message, { kind: "error" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmParticipantStep() {
    if (!participantStepRecovery || busy) return;
    setBusy(true);
    try {
      await replayParticipantStep(participantStepRecovery);
    } finally {
      setBusy(false);
    }
  }

  async function saveStep() {
    if (step === "abstract" || step === "participant") {
      const section = form.sections.find((candidate) => candidate.key === step);
      if (!section) return;
      if (step === "participant") {
        await saveParticipantStep(section);
        return;
      }
      await run(() => requestData(`/api/internal/forms/${form.id}/sections/${section.id}?eventId=${event.id}`, json("PATCH", {
        expectedUpdatedAt: form.updatedAt,
        patch: { title: section.title, pageHeading: section.pageHeading, descriptionHtml: section.descriptionHtml },
      })), "Abstract step saved", [`section:${section.id}`]);
      return;
    }
    const patch: FormPatch = step === "setup" ? {
      internalName: form.internalName,
      kind: form.kind,
      collectParticipants: form.collectParticipants,
    } : step === "welcome" ? {
      internalName: form.internalName,
      externalTitle: form.externalTitle,
      pageHeading: form.pageHeading,
      showWelcome: form.showWelcome,
      welcomeHtml: form.welcomeHtml,
    } : step === "settings" ? {
      status: form.status,
      opensAt: form.opensAt,
      closesAt: form.closesAt,
      submissionLimit: form.submissionLimit,
      successHtml: form.successHtml,
      autoRedirectToPortal: form.autoRedirectToPortal,
    } : {
      sendConfirmation: form.sendConfirmation,
      confirmationSubject: form.confirmationSubject,
      confirmationBodyHtml: form.confirmationBodyHtml,
    };
    await run(() => patchForm(patch), `${stepMeta.find((item) => item.id === step)?.label} step saved`, [`step:${step}`]);
  }

  async function saveField(field: BuilderField): Promise<boolean> {
    const structural = form.hasNonDraftSubmissions || field.locked ? {} : {
      key: field.key,
      fieldType: field.fieldType,
      required: field.required,
      optionLabels: field.options.map((option) => option.label),
      visibility: field.visibility,
      mapsTo: field.mapsTo,
    };
    return run(() => requestData(`/api/internal/forms/${form.id}/fields/${field.id}?eventId=${event.id}`, json("PATCH", {
      expectedUpdatedAt: form.updatedAt,
      // `reviewVisibility` is not structural: it changes what a *future* blind
      // reviewer sees, never the answers already pinned to a snapshot, so it
      // stays editable after the form locks.
      patch: { label: field.label, helpText: field.helpText, maxChars: field.maxChars, reviewVisibility: field.reviewVisibility, ...structural },
    })), "Question saved", [`field:${field.id}`]);
  }

  async function saveCompactField() {
    if (!selectedField) return;
    if (await saveField(selectedField)) setSelected(null);
  }

  async function addField() {
    const section = form.sections.find((candidate) => candidate.key === (step === "participant" ? "participant" : "abstract"));
    if (!section || !newLabel.trim()) return;
    const added = await run(() => requestData(`/api/internal/forms/${form.id}/fields?eventId=${event.id}`, json("POST", {
      expectedUpdatedAt: form.updatedAt,
      sectionId: section.id,
      label: newLabel,
      fieldType: newType,
    })), "Question added");
    if (!added) return;
    setAdding(false);
    setNewLabel("");
    setNewType("text");
    setAvailabilityAlert(null);
  }

  async function deleteField(field: BuilderField) {
    const deleted = await run(() => requestData(`/api/internal/forms/${form.id}/fields/${field.id}?eventId=${event.id}`, json("DELETE", { expectedUpdatedAt: form.updatedAt })), "Question removed", [`field:${field.id}`]);
    if (deleted) {
      setSelected(null);
      setPendingDelete(null);
    }
  }

  async function moveField(section: BuilderSection, fieldId: string, delta: -1 | 1) {
    const current = section.fields.findIndex((field) => field.id === fieldId);
    const target = current + delta;
    if (current < 0 || target < 0 || target >= section.fields.length) return;
    const ordered = section.fields.map((field) => field.id);
    const currentId = ordered[current];
    const targetId = ordered[target];
    if (!currentId || !targetId) return;
    ordered[current] = targetId;
    ordered[target] = currentId;
    await run(() => requestData(`/api/internal/forms/${form.id}/fields/reorder?eventId=${event.id}`, json("POST", {
      expectedUpdatedAt: form.updatedAt,
      sectionId: section.id,
      orderedFieldIds: ordered,
    })), "Question order saved");
  }

  async function copyLink() {
    const clickedAt = new Date().toISOString();
    if (formAvailability(persistedAvailabilityInput, clickedAt) !== "live") {
      setAvailabilityNow(clickedAt);
      toast("This form is not live, so its public link was not copied", { kind: "error" });
      return;
    }

    const copied = await copyText(`${window.location.origin}/submit/${event.slug}/${form.id}`);
    toast(copied ? "Live form link copied" : "Couldn’t copy the live link. Open it and copy the address from your browser.", copied ? undefined : { kind: "error" });
  }

  async function duplicateAsDraft() {
    if (busy || duplicating || participantStepRecovery) return;
    setDuplicating(true);
    try {
      const copy = await duplicateFormAsDraft(event.id, form.id);
      toast(`${form.internalName} duplicated as a new draft`);
      allowNextNavigation(() => router.push(`/events/${event.id}/forms/${copy.id}`), {
        destination: `/events/${event.id}/forms/${copy.id}`,
      });
    } catch (error) {
      toast(formDuplicateOutcomeUnknown(error)
        ? "Couldn’t confirm whether the draft copy was created. Return to Submission Forms and refresh before trying again."
        : error instanceof Error ? error.message : "The form could not be duplicated", { kind: "error" });
    } finally {
      setDuplicating(false);
    }
  }

  function applyAvailabilityAuthority(latest: BuilderForm) {
    const remaining = new Set(dirtyRevisions.current.keys());
    // Validate against this mounted builder before scheduling the state update,
    // so a mismatched response is caught by the reconciliation try/catch rather than
    // thrown later from inside React's updater.
    mergeFormAvailabilityAuthority(form, latest, remaining);
    setPersistedAvailabilityInput({ status: latest.status, opensAt: latest.opensAt, closesAt: latest.closesAt });
    setAvailabilityNow(new Date().toISOString());
    setForm((current) => mergeFormAvailabilityAuthority(current, latest, remaining));
    setDirty(remaining.size > 0);
    router.refresh();
  }

  function availabilityPatch(recovery: FormAvailabilityRecovery, replay: boolean): Promise<BuilderForm> {
    return requestData<BuilderForm>(`/api/internal/forms/${form.id}?eventId=${event.id}`, json("PATCH", {
      expectedUpdatedAt: recovery.expectedUpdatedAt,
      patch: { status: recovery.action === "open" ? "open" : "closed" },
      ...(replay ? { availabilityReplay: true } : {}),
    }));
  }

  async function replayAvailability(recovery: FormAvailabilityRecovery): Promise<boolean> {
    try {
      const latest = await availabilityPatch(recovery, true);
      const authority = formAvailabilityAuthoritySchema.parse(latest);
      const requestedStatus = recovery.action === "open" ? "open" : "closed";
      if (authority.status !== requestedStatus) {
        throw new AppError("INTERNAL", "The replay did not confirm the requested form status");
      }
      applyAvailabilityAuthority(latest);
      setAvailabilityRecovery(null);
      setPendingAvailabilityAction(null);
      toast(recovery.action === "open"
        ? "Form opened — confirmed from the completed request"
        : "Form closed — confirmed from the completed request");
      return true;
    } catch (error) {
      if (!formAvailabilityOutcomeUnknown(error)) {
        setAvailabilityRecovery(null);
        setPendingAvailabilityAction(null);
        if (isAppError(error)) toast(error.message, { kind: "error" });
        return false;
      }
      setAvailabilityRecovery(recovery);
      setPendingAvailabilityAction(null);
      toast(formAvailabilityRecoveryMessage(recovery.action), { kind: "error" });
      return false;
    }
  }

  async function checkCurrentAvailability() {
    if (!availabilityRecovery || busy) return;
    setBusy(true);
    try {
      await replayAvailability(availabilityRecovery);
    } finally {
      setBusy(false);
    }
  }

  function requestAvailabilityChange() {
    if (participantStepRecovery) {
      toast(PARTICIPANT_STEP_RECOVERY_MESSAGE, { kind: "error" });
      return;
    }
    if (availabilityRecovery) {
      toast(formAvailabilityRecoveryMessage(availabilityRecovery.action), { kind: "error" });
      return;
    }
    // Also refresh on intent: a backgrounded tab can throttle the boundary
    // timer, but its confirmation still must state the present consequence.
    setAvailabilityNow(new Date().toISOString());
    const action: FormAvailabilityAction = persistedAvailabilityInput.status === "open" ? "close" : "open";
    if (action === "open" && hasUnsavedBuilderTargets) {
      const message = "Publish every unsaved form change before opening. Only published content appears on the public form.";
      setAvailabilityAlert(message);
      toast(message, { kind: "error" });
      return;
    }
    setAvailabilityAlert(null);
    setPendingAvailabilityAction(action);
  }

  async function confirmAvailabilityChange() {
    if (!pendingAvailabilityAction || availabilityRecovery || participantStepRecovery || busy) return;
    const action = pendingAvailabilityAction;
    const recovery = { action, expectedUpdatedAt: form.updatedAt } satisfies FormAvailabilityRecovery;
    setBusy(true);
    try {
      const next = await availabilityPatch(recovery, false);
      setPersistedAvailabilityInput({ status: next.status, opensAt: next.opensAt, closesAt: next.closesAt });
      setAvailabilityNow(new Date().toISOString());
      const remaining = new Set(dirtyRevisions.current.keys());
      setForm((current) => mergeUnsavedBuilderEdits(next, current, remaining));
      setDirty(remaining.size > 0);
      if (remaining.size === 0 && !newQuestionDraftDirty && !routingDraftDirty) setAvailabilityAlert(null);
      setAvailabilityRecovery(null);
      setPendingAvailabilityAction(null);
      toast(action === "open" ? "Form availability updated" : "Form closed");
      router.refresh();
    } catch (error) {
      if (formAvailabilityOutcomeUnknown(error)) await replayAvailability(recovery);
      else if (isAppError(error)) toast(error.message, { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  const section = form.sections.find((candidate) => candidate.key === (step === "participant" ? "participant" : "abstract"));
  const availabilityActionCopy = pendingAvailabilityAction
    ? formAvailabilityActionCopy(pendingAvailabilityAction, persistedAvailabilityInput, availabilityNow)
    : null;
  return <div className="builder-wrap">
    <header className="builder-header">
      <div className="builder-title"><Link className="icon-button" aria-label="Back to forms" href={`/events/${event.id}/forms`}><ArrowLeft size={18} /></Link><div><div><h1>{form.internalName}</h1><StatusBadge value={availability} /></div><span>Version {form.currentVersion} · <i className={dirty ? "saving" : "saved"}>{dirty ? "Unpublished changes" : "Version published"}</i></span></div></div>
      <div className="builder-actions">
        <div className="builder-edit-actions" role="group" aria-label="Form editing actions">
          {availability === "live" && <Button variant="secondary" aria-label="Copy live form link" title="Copy live form link" onClick={() => void copyLink()}><Copy size={16} /> <span className="builder-action-label">Copy live link</span></Button>}
          <Link className="button button-secondary" aria-label="Preview form" title="Preview form" target="_blank" rel="noreferrer" href={`/events/${event.id}/forms/${form.id}/preview`}><Eye size={16} /> <span className="builder-action-label">Preview</span></Link>
          <Button id="publish-form-version" aria-label="Publish the current step as a new immutable form version" title="Publish the current step as a new immutable form version" disabled={busy || participantStepRecovery !== null} onClick={() => void saveStep()}><Save size={16} /> <span className="builder-action-label">{busy ? "Publishing…" : "Publish version"}</span></Button>
        </div>
        <div className="builder-lifecycle-actions" role="group" aria-label="Form availability">
          <span>Availability</span>
          <Button
            aria-label={availabilityActionLabel}
            title={availabilityActionLabel}
            variant={persistedAvailabilityInput.status === "open" ? "secondary" : "primary"}
            disabled={busy || availabilityRecovery !== null || participantStepRecovery !== null}
            onClick={requestAvailabilityChange}
          >
            {persistedAvailabilityInput.status === "open" ? <CircleStop size={16} /> : <Rocket size={16} />}
            <span className="builder-action-label">{availabilityActionLabel}</span>
          </Button>
        </div>
      </div>
    </header>
    <div className="builder-layout"><aside className="builder-rail"><span>BUILD YOUR FORM</span>{stepMeta.map((item, index) => { const Icon = item.icon; return <button key={item.id} className={step === item.id ? "active" : ""} onClick={() => setStep(item.id)}><i>{index + 1}</i><Icon size={17} /><b>{item.label}</b>{form.currentVersion > index && <Check size={14} />}</button>; })}<div className="builder-completeness"><div><span>Published snapshots</span><b>{form.currentVersion}</b></div><small>Every publish creates a new immutable version.</small></div></aside>
      <div className="builder-canvas">
        {availabilityRecovery && <div className="locked-banner" role="alert"><AlertTriangle size={17} /><div><b>Form status is unconfirmed</b><span>{formAvailabilityRecoveryMessage(availabilityRecovery.action)}</span></div><Button size="sm" variant="secondary" disabled={busy} onClick={() => void checkCurrentAvailability()}>{busy ? "Confirming…" : "Confirm current status"}</Button></div>}
        {participantStepRecovery && <div className="locked-banner" role="alert"><AlertTriangle size={17} /><div><b>Participant save is unconfirmed</b><span>{PARTICIPANT_STEP_RECOVERY_MESSAGE}</span></div><Button size="sm" variant="secondary" disabled={busy} onClick={() => void confirmParticipantStep()}>{busy ? "Confirming…" : "Confirm participant save"}</Button></div>}
        {availabilityAlert && hasUnsavedBuilderTargets && <div className="locked-banner" role="alert"><Save size={17} /><div><b>Publish before opening</b><span>{availabilityAlert}</span></div></div>}
        {form.hasNonDraftSubmissions && (step === "setup" || step === "abstract" || step === "participant") && <div className="locked-banner"><LockKeyhole size={17} /><div><b>Structure locked after submissions</b><span>You can still update labels, guidance, dates, and copy. A duplicate starts as a draft without submissions, routing rules, or opening and closing dates.</span></div><Button size="sm" variant="secondary" disabled={busy || duplicating || participantStepRecovery !== null} onClick={() => runGuarded(() => { void duplicateAsDraft(); })}><Copy size={14} /> {duplicating ? "Duplicating…" : "Duplicate as draft"}</Button></div>}
        {step === "setup" && <SetupStep form={form} onChange={applyLocal} />}
        {step === "welcome" && <WelcomeStep form={form} onChange={applyLocal} />}
        {(step === "abstract" || step === "participant") && section && <FieldsStep section={section} participant={step === "participant"} form={form} selected={selected?.fieldId ?? null} onSelect={(fieldId) => setSelected({ sectionId: section.id, fieldId })} onSectionChange={(patch) => applySection(section.id, patch)} onFormChange={applyLocal} onAdd={() => setAdding(true)} onMove={(fieldId, delta) => void moveField(section, fieldId, delta)} onRoutingDraftStateChange={handleRoutingDraftStateChange} />}
        {step === "settings" && <SettingsStep event={event} form={form} onChange={applyLocal} />}
        {step === "notifications" && <NotificationsStep form={form} onChange={applyLocal} />}
        <footer className="builder-footer"><Button variant="secondary" disabled={step === "setup"} onClick={() => setStep(BUILDER_STEPS[Math.max(0, BUILDER_STEPS.indexOf(step) - 1)] ?? step)}>Back</Button><a className="builder-publish-link" href="#publish-form-version">Publish this step from the header <ArrowUp size={14} aria-hidden="true" /></a><Button variant="secondary" disabled={step === "notifications"} onClick={() => setStep(BUILDER_STEPS[Math.min(BUILDER_STEPS.length - 1, BUILDER_STEPS.indexOf(step) + 1)] ?? step)}>Next</Button></footer>
      </div>
      <aside className="builder-inspector">{selectedField ? <FieldInspector field={selectedField} form={form} onChange={(patch) => applyField(selectedField.id, patch)} onSave={() => void saveField(selectedField)} onDelete={() => setPendingDelete(selectedField)} busy={busy} /> : (step === "abstract" || step === "participant") && liveSnapshot ? <LiveBuilderPreview snapshot={liveSnapshot} /> : <MockBuilderPreview form={form} step={step} />}</aside>
    </div>
    {compactInspector && selectedField && <Modal
      open
      onClose={busy ? () => undefined : () => setSelected(null)}
      title={`Edit “${selectedField.label}”`}
      description="Update this question, then save to return to the form."
      wide
    >
      <div className="compact-field-inspector">
        <FieldInspector
          field={selectedField}
          form={form}
          onChange={(patch) => applyField(selectedField.id, patch)}
          onSave={() => void saveCompactField()}
          onDelete={() => setPendingDelete(selectedField)}
          busy={busy}
        />
      </div>
    </Modal>}
    <Modal open={adding} onClose={closeAddQuestion} title="Add a question" description="Choose one of the eight supported response types." footer={<><Button variant="secondary" onClick={closeAddQuestion}>Cancel</Button><Button disabled={!newLabel.trim() || busy} onClick={() => void addField()}>Add question</Button></>}><div className="form-stack"><Field label="Question label" required><input autoFocus required value={newLabel} onChange={(current) => setNewLabel(current.target.value)} placeholder="What would you like to ask?" /></Field><Field label="Response type" group><div className="type-grid">{addableTypes.map((item) => <button type="button" aria-pressed={newType === item.type} key={item.type} className={newType === item.type ? "active" : ""} onClick={() => setNewType(item.type)}><span>{typeIcon(item.type)}</span><div><b>{item.label}</b><small>{item.description}</small></div>{newType === item.type && <CircleCheck size={16} />}</button>)}</div></Field></div></Modal>
    <ConfirmDialog
      open={pendingAvailabilityAction !== null}
      title={availabilityActionCopy?.title ?? "Change form availability?"}
      body={availabilityActionCopy?.body ?? "Review this availability change before continuing."}
      confirmLabel={availabilityActionCopy?.confirmLabel ?? "Confirm"}
      variant={pendingAvailabilityAction === "open" ? "primary" : "destructive"}
      confirmDisabled={availabilityRecovery !== null || participantStepRecovery !== null}
      onConfirm={confirmAvailabilityChange}
      onCancel={() => setPendingAvailabilityAction(null)}
    />
    <ConfirmDialog
      open={pendingDelete !== null}
      title={pendingDelete ? `Delete “${pendingDelete.label}”?` : "Delete question?"}
      body="This question and its draft configuration will be permanently removed."
      confirmLabel="Delete question"
      onConfirm={async () => { if (pendingDelete) await deleteField(pendingDelete); }}
      onCancel={() => setPendingDelete(null)}
    />
  </div>;
}

function SetupStep({ form, onChange }: { form: BuilderForm; onChange: (patch: FormPatch) => void }) {
  return <section className="builder-step"><header><div className="step-number">1</div><div><h2>Submission setup</h2><p>Choose the submission type and whether to collect participant details.</p></div></header><div className="builder-card form-stack"><Field label="Internal form name" required hint={`${form.internalName.length}/255`}><input required maxLength={255} value={form.internalName} onChange={(current) => onChange({ internalName: current.target.value })} /></Field><Field label="Submission type" group><div className="choice-cards"><button type="button" aria-pressed={form.kind === "abstract"} disabled={form.hasNonDraftSubmissions} className={form.kind === "abstract" ? "active" : ""} onClick={() => onChange({ kind: "abstract" })}><FileText size={20} /><b>Abstracts</b><small>Proposals reviewed before scheduling</small></button><button type="button" aria-pressed={form.kind === "session"} disabled={form.hasNonDraftSubmissions} className={form.kind === "session" ? "active" : ""} onClick={() => onChange({ kind: "session" })}><Users size={20} /><b>Sessions</b><small>Complete session submissions</small></button></div></Field><div className="inline-setting"><div><b>Collect participant information</b><small>Speaker identity fields remain protected.</small></div><Switch label="Collect participant information" checked={form.collectParticipants} disabled={form.hasNonDraftSubmissions} onClick={() => onChange({ collectParticipants: !form.collectParticipants })} /></div><div className="setting-note"><FileText size={18} /><div><b>No payments step</b><p>Payments are outside this form’s scope.</p></div></div></div></section>;
}

function WelcomeStep({ form, onChange }: { form: BuilderForm; onChange: (patch: FormPatch) => void }) {
  return <section className="builder-step"><header><div className="step-number">2</div><div><h2>Welcome screen</h2><p>Set the public title, heading, and opening message.</p></div></header><div className="builder-card form-stack"><Field label="Internal form name" required hint={`${form.internalName.length}/255`}><input required maxLength={255} value={form.internalName} onChange={(current) => onChange({ internalName: current.target.value })} /></Field><Field label="External form title" required hint={`${form.externalTitle.length}/255`}><input required maxLength={255} value={form.externalTitle} onChange={(current) => onChange({ externalTitle: current.target.value })} /></Field><Field label="Page heading" required hint={`${form.pageHeading.length}/15`}><input required maxLength={15} value={form.pageHeading} onChange={(current) => onChange({ pageHeading: current.target.value })} /></Field><div className="inline-setting"><div><b>Show welcome message</b><small>Speakers see this before starting.</small></div><Switch label="Show welcome message" checked={form.showWelcome} onClick={() => onChange({ showWelcome: !form.showWelcome })} /></div>{form.showWelcome && <Field label="Welcome message"><RichTextEditor ariaLabel="Welcome message" value={form.welcomeHtml} onChange={(welcomeHtml) => onChange({ welcomeHtml })} maxChars={5000} /></Field>}</div></section>;
}

function FieldsStep({ section, participant, form, selected, onSelect, onSectionChange, onFormChange, onAdd, onMove, onRoutingDraftStateChange }: { section: BuilderSection; participant: boolean; form: BuilderForm; selected: string | null; onSelect: (fieldId: string) => void; onSectionChange: (patch: Partial<BuilderSection>) => void; onFormChange: (patch: FormPatch) => void; onAdd: () => void; onMove: (fieldId: string, delta: -1 | 1) => void; onRoutingDraftStateChange: (dirty: boolean) => void }) {
  return <section className="builder-step"><header><div className="step-number">{participant ? 4 : 3}</div><div><h2>{participant ? "Participant information" : "Abstract information"}</h2><p>{participant ? "Collect speaker and co-speaker information." : "Build the proposal your review team will score."}</p></div></header><div className="builder-card form-stack"><Field label="Section title" required hint={`${section.title.length}/255`}><input required maxLength={255} value={section.title} onChange={(current) => onSectionChange({ title: current.target.value })} /></Field><Field label="Page heading" required hint={`${section.pageHeading.length}/15`}><input required maxLength={15} value={section.pageHeading} onChange={(current) => onSectionChange({ pageHeading: current.target.value })} /></Field><Field label="Description and instructions"><RichTextEditor ariaLabel={`${participant ? "Participant" : "Abstract"} description and instructions`} value={section.descriptionHtml} onChange={(descriptionHtml) => onSectionChange({ descriptionHtml })} maxChars={5000} /></Field></div><div className="builder-card field-section"><div className="section-heading"><div><h3>Form questions</h3><p>{section.fields.length} live questions</p></div></div><div className="builder-fields">{section.fields.map((field, index) => <div className={selected === field.id ? "selected builder-field-row" : "builder-field-row"} key={field.id}><button type="button" className="field-row-main" onClick={() => onSelect(field.id)}><span className="field-type-icon">{typeIcon(field.fieldType)}</span><div><b>{field.label}{field.required && <em>*</em>}</b><small>{typeLabel(field.fieldType)}{field.visibility ? " · Conditional" : ""}</small></div>{field.locked && <LockKeyhole size={14} className="lock" />}</button><button type="button" className="icon-button" aria-label={`Move ${field.label} up`} disabled={index === 0 || busyLock(form)} onClick={() => onMove(field.id, -1)}><ArrowUp size={14} /></button><button type="button" className="icon-button" aria-label={`Move ${field.label} down`} disabled={index === section.fields.length - 1 || busyLock(form)} onClick={() => onMove(field.id, 1)}><ArrowDown size={14} /></button></div>)}</div><Button variant="ghost" className="add-question" disabled={form.hasNonDraftSubmissions} onClick={onAdd}><Plus size={16} /> Add question</Button>
  {/* M13b/M24: routing rules stamp a Track/Tags on submit, which only means
      something for a CFP submission — portal forms (context='portal') never
      show this panel (plan/modules/M13b-rules-ui.md "Portal forms" guardrail). */}
  {!participant && form.context === "cfp" && <RoutingRulesPanel eventId={eventIdSchema.parse(form.eventId)} formId={form.id} onDraftStateChange={onRoutingDraftStateChange} />}</div>{participant && <ParticipantRoles form={form} onChange={onFormChange} />}</section>;
}

export function ParticipantRoles({ form, onChange }: { form: BuilderForm; onChange: (patch: FormPatch) => void }) {
  return <div className="builder-card"><h3>Participant roles</h3><div className="toggle-list">{form.participantRoles.map((role) => {
    const label = role.role.replaceAll("_", "-");
    if (role.role === "speaker") {
      return <div key={role.role}><div><b>{label}</b><p>The primary speaker is always required.</p></div><span className="switch on" aria-hidden="true"><i /></span></div>;
    }
    return <div key={role.role}><div><b>{label}</b><p>Allow this role on submitted proposals.</p></div><Switch label={`Allow ${label} role`} checked={role.enabled} onClick={() => onChange({ participantRoles: withRequiredSpeakerRole(form.participantRoles.map((candidate) => candidate.role === role.role ? { ...candidate, enabled: !candidate.enabled } : candidate)) })} /></div>;
  })}</div></div>;
}

function FieldInspector({ field, form, onChange, onSave, onDelete, busy }: { field: BuilderField; form: BuilderForm; onChange: (patch: Partial<BuilderField>) => void; onSave: () => void; onDelete: () => void; busy: boolean }) {
  const flattened = form.sections.flatMap((section) => section.fields);
  const position = flattened.findIndex((candidate) => candidate.id === field.id);
  const earlier = flattened.slice(0, position);
  const lockedStructure = form.hasNonDraftSubmissions;
  return <div className="inspector-content"><header><div><span className="inspector-kicker">QUESTION</span><h3>Edit field</h3></div>{field.locked && <StatusBadge value="locked" />}</header><div className="form-stack">
    <Field label="Label"><input maxLength={255} value={field.label} onChange={(current) => onChange({ label: current.target.value })} /></Field>
    <Field label="Key" hint={field.locked || lockedStructure ? "Keys are immutable for this field." : "Used by integrations and stays stable when labels change."}><input disabled={field.locked || lockedStructure} value={field.key} onChange={(current) => onChange({ key: current.target.value })} /></Field>
    <Field label="Response type"><Select disabled={field.locked || lockedStructure} value={field.fieldType} onChange={(current) => onChange({ fieldType: current.target.value as FieldType })}>{addableTypes.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}</Select></Field>
    <Field label="Help text"><textarea value={field.helpText} onChange={(current) => onChange({ helpText: current.target.value })} /></Field>
    {["text", "textarea", "richtext"].includes(field.fieldType) && <Field label="Maximum characters"><input type="number" min={1} value={field.maxChars ?? ""} onChange={(current) => onChange({ maxChars: current.target.value ? Number(current.target.value) : null })} /></Field>}
    <div className="inline-setting"><div><b>Required</b><small>Speakers must answer this question.</small></div><Switch label={`Require ${field.label}`} checked={field.required} disabled={field.locked || lockedStructure} onClick={() => onChange({ required: !field.required })} /></div>
    <Field label="Blind review" hint={field.locked ? "Locked identity fields are always hidden from anonymized reviewers." : "Anonymized rounds show only the answers marked as proposal content. Anything left as identity is withheld."}><Select disabled={field.locked} value={field.reviewVisibility} onChange={(current) => onChange({ reviewVisibility: current.target.value as ReviewVisibility })}><option value="identity">Identity — hide from anonymized reviewers</option><option value="content">Proposal content — show to anonymized reviewers</option></Select></Field>
    {["dropdown", "multiselect"].includes(field.fieldType) && <Field label="Options" hint={lockedStructure ? "Options are locked after the first submission." : field.mapsTo === "submission.track_id" ? "One existing event track per line; bindings are validated on save." : field.mapsTo === "submission.format_id" ? "One existing session format per line; bindings are validated on save." : "One option per line; existing option ids are preserved."}><textarea disabled={lockedStructure} value={field.options.map((option) => option.label).join("\n")} onChange={(current) => onChange({ options: current.target.value.split("\n").map((label, index) => ({ ...(field.options[index] ?? { id: `draft-${index}` }), label })) })} /></Field>}
    {!field.locked && <Field label="Maps to"><Select disabled={lockedStructure} value={field.mapsTo ?? ""} onChange={(current) => onChange({ mapsTo: (current.target.value || null) as MapsToTarget | null })}><option value="">No system mapping</option>{MAPS_TO_TARGETS.map((target) => <option key={target} value={target}>{target}</option>)}</Select></Field>}
    {/* Visibility is a structural change (guards.ts `fieldPatchIsStructural`)
        and is rejected server-side once the form has non-draft submissions —
        matching the locked hint already used above for Options. */}
    {!field.locked && (lockedStructure
      ? <div className="condition-card"><div><b>Conditional visibility</b><small>Visibility is locked after the first submission.</small></div></div>
      : <VisibilityRuleEditor field={field} earlierFields={earlier} value={field.visibility} onChange={(visibility) => onChange({ visibility })} />)}
    <Button disabled={busy} onClick={onSave}><Save size={15} /> Save question</Button>
    {!field.locked && <Button variant="ghost" disabled={busy || lockedStructure} className="delete-field" onClick={onDelete}><Trash2 size={15} /> Delete question</Button>}
  </div></div>;
}

function MockBuilderPreview({ form, step }: { form: BuilderForm; step: BuilderStep }) {
  const section = form.sections.find((candidate) => candidate.key === (step === "participant" ? "participant" : "abstract"));
  return <div className="preview-pane"><header><span>LIVE PREVIEW</span><b>Desktop</b></header><div className="mini-browser"><div className="mini-browser-top"><i /><i /><i /></div><div className="mini-public"><span className="mini-event-logo">Openboard</span>{step === "welcome" ? <><small>CALL FOR SPEAKERS</small><h3>{form.pageHeading}</h3><RichTextView html={form.welcomeHtml} /><span className="mini-preview-button">Get started</span></> : <><div className="mini-stepper"><i className="done" /><i className="active" /><i /><i /></div><small>{step === "settings" ? "REVIEW & SUBMIT" : "YOUR SESSION"}</small><h3>{section?.pageHeading ?? form.externalTitle}</h3>{section?.fields.slice(0, 3).map((field) => <div className="mini-preview-field" key={field.id}><span>{field.label}</span><i>{field.helpText || "Your answer"}</i></div>)}</>}</div></div><p className="preview-hint"><Eye size={14} /> Preview updates as you edit.</p></div>;
}

function busyLock(form: BuilderForm) { return form.sections.length === 0; }
function typeLabel(type: FieldType) { return addableTypes.find((item) => item.type === type)?.label ?? type; }
function typeIcon(type: FieldType) { const labels: Record<string, string> = { text: "T", textarea: "¶", richtext: "Aa", dropdown: "⌄", multiselect: "☷", email: "@", url: "↗", file: "↑" }; return labels[type] ?? "T"; }
