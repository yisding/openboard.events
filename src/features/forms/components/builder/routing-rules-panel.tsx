"use client";

import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent, type UniqueIdentifier } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Route as RouteIcon, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  fieldIdSchema,
  fieldTypeSchema,
  formContextSchema,
  formOptionSchema,
  routingRuleSchema,
  tagDtoSchema,
  tagIdSchema,
  trackDtoSchema,
  type Condition,
  type EventId,
  type FormId,
  type TagDTO,
  type TagId,
  type TrackDTO,
  type TrackId,
} from "@/shared/contracts";
import { Button, EmptyState, Select, Switch } from "@/shared/ui/ui-kit";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { LoadFailure } from "@/shared/ui/app/load-failure";
import { SkeletonText } from "@/shared/ui/app/skeleton";
import { editorDraftChanged, requestGuardedEditorClose } from "@/shared/ui/app/modal-editor-guard";
import { useGuardedAction, useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";
import { ConditionRow, type ConditionSourceField } from "./condition-row";
import { ruleSummary } from "./rule-summary";

const dangleIssueSchema = z.object({
  kind: z.enum(["field", "option"]),
  conditionIndex: z.number(),
  fieldId: z.string(),
  value: z.string().optional(),
});
const routingRuleRowSchema = routingRuleSchema.extend({
  danglingConditions: z.array(dangleIssueSchema),
  danglingTagIds: z.array(tagIdSchema),
  trackMissing: z.boolean(),
});
type RoutingRuleRow = z.infer<typeof routingRuleRowSchema>;

const conditionSourceFieldSchema = z.object({
  id: fieldIdSchema,
  label: z.string(),
  fieldType: fieldTypeSchema,
  options: z.array(formOptionSchema),
});
const formFieldsResponseSchema = z.object({
  context: formContextSchema,
  // `key` is carried so the participant section can be dropped below — the
  // server refuses to route on those fields, so offering them is a dead end.
  sections: z.array(z.object({ key: z.string(), fields: z.array(conditionSourceFieldSchema) })),
});

const rulesListSchema = z.array(routingRuleRowSchema);
const tracksListSchema = z.array(trackDtoSchema);
const tagsListSchema = z.array(tagDtoSchema);
const deletedSchema = z.object({ deleted: z.boolean() });
const reorderedSchema = z.object({ reordered: z.boolean() });

type RoutingRuleInput = { match: "all" | "any"; conditions: Condition[]; setTrackId: TrackId | null; addTagIds: TagId[]; enabled: boolean };

function draftFromRule(rule: RoutingRuleRow): RoutingRuleInput {
  return { match: rule.match, conditions: rule.conditions, setTrackId: rule.setTrackId ?? null, addTagIds: [...rule.addTagIds], enabled: rule.enabled };
}

function emptyDraft(sourceFields: ConditionSourceField[]): RoutingRuleInput {
  const source = sourceFields[0];
  return {
    match: "all",
    conditions: source ? [{ sourceFieldId: source.id, op: "answered" }] : [],
    setTrackId: null,
    addTagIds: [],
    enabled: true,
  };
}

/**
 * The ordered category-routing panel, mounted at the bottom of the builder's
 * Abstract Information step only when `form.context === 'cfp'` (M24's portal
 * forms carry no conditional logic and never see this). Fetches its own data
 * — the panel's only inputs are `eventId`/`formId`.
 */
export function RoutingRulesPanel({ eventId, formId, onDraftStateChange }: { eventId: EventId; formId: FormId; onDraftStateChange?: (dirty: boolean) => void }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [context, setContext] = useState<"cfp" | "portal">("cfp");
  const [fields, setFields] = useState<ConditionSourceField[]>([]);
  const [rules, setRules] = useState<RoutingRuleRow[]>([]);
  const [tracks, setTracks] = useState<TrackDTO[]>([]);
  const [tags, setTags] = useState<TagDTO[]>([]);
  const [editing, setEditing] = useState<{ ruleId: string | null; draft: RoutingRuleInput } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RoutingRuleRow | null>(null);
  const [busy, setBusy] = useState(false);
  // Rule order decides which rule wins, so it is a setting — not decoration.
  // The keyboard sensor is what makes it reachable without a pointer: Space
  // picks a rule up, the arrows move it, Space drops it.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const baseline = editing?.ruleId
    ? rules.find((rule) => rule.id === editing.ruleId)
    : null;
  const editorDirty = editing !== null && editorDraftChanged(
    editing.draft,
    baseline ? draftFromRule(baseline) : emptyDraft(fields),
  );
  useUnsavedWorkGuard(editorDirty);
  const { runGuarded } = useGuardedAction();

  useEffect(() => {
    onDraftStateChange?.(editorDirty);
  }, [editorDirty, onDraftStateChange]);
  useEffect(() => () => onDraftStateChange?.(false), [onDraftStateChange]);

  // dnd-kit's default announcements read the raw draggable id, so a keyboard
  // reorder was narrated as "Draggable item 3f0a…-… was moved over droppable
  // area 9c11…-…" — two UUIDs describing the one setting on this panel that is
  // *only* an order. Name the rule by its position and its plain-English
  // summary instead, the same treatment the agenda day view's drags get.
  const announcements = useMemo<Announcements>(() => {
    const positionOf = (id: UniqueIdentifier) => rules.findIndex((rule) => String(rule.id) === String(id)) + 1;
    const describe = (id: UniqueIdentifier) => {
      const position = positionOf(id);
      const rule = rules[position - 1];
      if (!rule) return "this rule";
      return `rule ${position} of ${rules.length}, ${ruleSummary(rule, fields, { tracks, tags })}`;
    };
    return {
      onDragStart: ({ active }) => `Picked up ${describe(active.id)}.`,
      onDragOver: ({ active, over }) => over && over.id !== active.id
        ? `${describe(active.id)} is over position ${positionOf(over.id)} of ${rules.length}.`
        : undefined,
      onDragEnd: ({ active, over }) => over && over.id !== active.id
        ? `Moved ${describe(active.id)} to position ${positionOf(over.id)} of ${rules.length}. The first matching rule wins.`
        : `${describe(active.id)} stayed where it was.`,
      onDragCancel: ({ active }) => `Cancelled. ${describe(active.id)} stayed where it was.`,
    };
  }, [rules, fields, tracks, tags]);

  function requestEditor(next: { ruleId: string | null; draft: RoutingRuleInput } | null) {
    requestGuardedEditorClose({ busy, dirty: editorDirty, runGuarded, close: () => setEditing(next) });
  }

  async function load() {
    setStatus("loading");
    try {
      const [form, ruleRows, trackRows, tagRows] = await Promise.all([
        api(`forms/${formId}?eventId=${eventId}`, formFieldsResponseSchema),
        api(`forms/${formId}/routing-rules?eventId=${eventId}`, rulesListSchema),
        api(`events/${eventId}/vocab/tracks`, tracksListSchema),
        api(`events/${eventId}/vocab/tags`, tagsListSchema),
      ]);
      setContext(form.context);
      // The server's own `routableFields` excludes the participant section, and
      // `assertConditionsValid` rejects a rule that names one of its fields.
      // Offering them here meant picking, say, "Company" as a routing source
      // produced "Condition 1 references a question that is not on this form"
      // — about a question visibly present in the picker just used, with no way
      // to ever save the rule.
      setFields(form.sections.filter((section) => section.key !== "participant").flatMap((section) => section.fields));
      setRules(ruleRows);
      setTracks(trackRows);
      setTags(tagRows);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, formId]);

  if (context !== "cfp") return null;
  if (status === "loading") return <section className="panel routing-rules-panel"><div className="routing-rules-panel__content"><SkeletonText lines={3} label="Loading routing rules…" /></div></section>;
  if (status === "error") {
    // Not an empty state: nothing here is empty, the read failed. An
    // `EmptyState` announced nothing and sent the organizer off to reload the
    // whole builder, losing every other unsaved panel with it.
    return (
      <section className="panel routing-rules-panel">
        <div className="routing-rules-panel__content">
          <LoadFailure message="Routing rules could not be loaded." onRetry={() => void load()} />
        </div>
      </section>
    );
  }

  async function saveDraft() {
    if (!editing || busy) return;
    setBusy(true);
    try {
      const saved = editing.ruleId
        ? await api(`forms/${formId}/routing-rules/${editing.ruleId}?eventId=${eventId}`, routingRuleRowSchema, { method: "PATCH", body: editing.draft })
        : await api(`forms/${formId}/routing-rules?eventId=${eventId}`, routingRuleRowSchema, { method: "POST", body: editing.draft });
      setRules((current) => editing.ruleId
        ? current.map((rule) => rule.id === saved.id ? saved : rule)
        : [...current, saved].sort((a, b) => a.sortOrder - b.sortOrder));
      setEditing(null);
      toast("Routing rule saved");
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "That routing rule did not save", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(rule: RoutingRuleRow) {
    const previous = rules;
    const nextEnabled = !rule.enabled;
    setRules((current) => current.map((candidate) => candidate.id === rule.id ? { ...candidate, enabled: nextEnabled } : candidate));
    try {
      const saved = await api(`forms/${formId}/routing-rules/${rule.id}?eventId=${eventId}`, routingRuleRowSchema, {
        method: "PATCH",
        body: { ...draftFromRule(rule), enabled: nextEnabled },
      });
      setRules((current) => current.map((candidate) => candidate.id === rule.id ? saved : candidate));
    } catch {
      setRules(previous);
      toast("That change did not save", { kind: "error" });
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const removed = pendingDelete;
    setPendingDelete(null);
    setRules((current) => current.filter((rule) => rule.id !== removed.id));
    try {
      await api(`forms/${formId}/routing-rules/${removed.id}?eventId=${eventId}`, deletedSchema, { method: "DELETE" });
      toast("Routing rule deleted");
    } catch {
      setRules((current) => [...current, removed].sort((a, b) => a.sortOrder - b.sortOrder));
      toast("That delete failed — the rule has been restored", { kind: "error" });
    }
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = rules.findIndex((rule) => rule.id === active.id);
    const toIndex = rules.findIndex((rule) => rule.id === over.id);
    if (fromIndex === -1 || toIndex === -1) return;
    const reordered = arrayMove(rules, fromIndex, toIndex);
    setRules(reordered);
    try {
      await api(`forms/${formId}/routing-rules/reorder?eventId=${eventId}`, reorderedSchema, {
        method: "POST",
        body: { orderedIds: reordered.map((rule) => rule.id) },
      });
    } catch {
      setRules(rules);
      toast("That reorder did not save — the previous order has been restored", { kind: "error" });
    }
  }

  return (
      <section className="panel routing-rules-panel">
      <header>
        <div>
          <h2>Category routing</h2>
          <p><b>Rules run in order; the first match wins.</b> A submission that matches no rule stays Uncategorized.</p>
        </div>
      </header>

      <div className="routing-rules-panel__content">
      {rules.length === 0 ? (
        <EmptyState
          icon={<RouteIcon size={20} />}
          title="No routing rules"
          description="Every submission lands as Uncategorized. Add a rule to auto-assign a Track."
        />
      ) : (
        <DndContext sensors={sensors} accessibility={{ announcements }} onDragEnd={(routingEvent) => void onDragEnd(routingEvent)}>
          <SortableContext items={rules.map((rule) => rule.id)} strategy={verticalListSortingStrategy}>
            <div className="routing-rule-list">
              {rules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  fields={fields}
                  tracks={tracks}
                  tags={tags}
                  editing={editing?.ruleId === rule.id ? editing.draft : null}
                  onEdit={() => requestEditor({ ruleId: rule.id, draft: draftFromRule(rule) })}
                  onCancel={() => requestEditor(null)}
                  onDraftChange={(draft) => setEditing({ ruleId: rule.id, draft })}
                  onSave={() => void saveDraft()}
                  onToggle={() => void toggleEnabled(rule)}
                  onDelete={() => setPendingDelete(rule)}
                  busy={busy}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {editing?.ruleId === null ? (
        <div className="condition-card routing-rule-card routing-rule-card--new">
          <RuleEditorBody draft={editing.draft} fields={fields} tracks={tracks} tags={tags} onChange={(draft) => setEditing({ ruleId: null, draft })} />
          <div className="routing-rule-card__actions">
            <Button variant="secondary" onClick={() => requestEditor(null)}>Cancel</Button>
            <Button disabled={busy} onClick={() => void saveDraft()}>{busy ? "Saving…" : "Save rule"}</Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          className="add-question"
          disabled={fields.length === 0}
          onClick={() => requestEditor({ ruleId: null, draft: emptyDraft(fields) })}
        >
          <Plus size={16} /> Add rule
        </Button>
      )}
      {fields.length === 0 && <small>Add a question to this form before adding a routing rule.</small>}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this routing rule?"
        body="Submissions will no longer be matched against it. This cannot be undone."
        confirmLabel="Delete rule"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
      </div>
    </section>
  );
}

function RuleCard({
  rule,
  fields,
  tracks,
  tags,
  editing,
  onEdit,
  onCancel,
  onDraftChange,
  onSave,
  onToggle,
  onDelete,
  busy,
}: {
  rule: RoutingRuleRow;
  fields: ConditionSourceField[];
  tracks: TrackDTO[];
  tags: TagDTO[];
  editing: RoutingRuleInput | null;
  onEdit: () => void;
  onCancel: () => void;
  onDraftChange: (draft: RoutingRuleInput) => void;
  onSave: () => void;
  onToggle: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const sortable = useSortable({ id: rule.id });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  const dangling = rule.danglingConditions.length > 0 || rule.danglingTagIds.length > 0 || rule.trackMissing;
  const summary = ruleSummary(rule, fields, { tracks, tags });

  return (
    <div ref={sortable.setNodeRef} style={style} className="condition-card routing-rule-card">
      <div className="routing-rule-card__row">
        <button type="button" className="icon-button" aria-label={`Reorder rule: ${summary}`} {...sortable.attributes} {...sortable.listeners}>
          <GripVertical size={15} />
        </button>
        <Switch label={`Rule: ${summary}`} checked={rule.enabled} onClick={onToggle} />
        <p className="rule-summary-line">{summary}</p>
        {dangling && (
          <span className="status-badge status-option-deleted" title="A condition, tag, or track this rule references was deleted. It has been disabled.">
            <TriangleAlert size={12} /> Option deleted
          </span>
        )}
        {!editing && <Button variant="secondary" size="sm" onClick={onEdit}>{dangling ? "Fix rule" : "Edit"}</Button>}
        {!editing && <Button variant="ghost" size="sm" className="delete-field" onClick={onDelete}>Delete</Button>}
      </div>
      {editing && (
        <>
          <RuleEditorBody draft={editing} fields={fields} tracks={tracks} tags={tags} onChange={onDraftChange} danglingConditionIndexes={new Set(rule.danglingConditions.map((issue) => issue.conditionIndex))} />
          <div className="routing-rule-card__actions">
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button disabled={busy} onClick={onSave}>{busy ? "Saving…" : "Save rule"}</Button>
          </div>
        </>
      )}
    </div>
  );
}

function RuleEditorBody({
  draft,
  fields,
  tracks,
  tags,
  onChange,
  danglingConditionIndexes,
}: {
  draft: RoutingRuleInput;
  fields: ConditionSourceField[];
  tracks: TrackDTO[];
  tags: TagDTO[];
  onChange: (draft: RoutingRuleInput) => void;
  danglingConditionIndexes?: Set<number>;
}) {
  function updateCondition(index: number, condition: Condition) {
    onChange({ ...draft, conditions: draft.conditions.map((candidate, candidateIndex) => candidateIndex === index ? condition : candidate) });
  }
  function removeCondition(index: number) {
    if (draft.conditions.length <= 1) return;
    onChange({ ...draft, conditions: draft.conditions.filter((_, candidateIndex) => candidateIndex !== index) });
  }
  function addCondition() {
    if (draft.conditions.length >= 5) return;
    const source = fields[0];
    if (!source) return;
    onChange({ ...draft, conditions: [...draft.conditions, { sourceFieldId: source.id, op: "answered" }] });
  }

  return (
    <div className="visibility-rule-editor__body">
      <label className="match-select">
        <span>Match</span>
        <Select value={draft.match} onChange={(event) => onChange({ ...draft, match: event.target.value as "all" | "any" })}>
          <option value="all">all of the following</option>
          <option value="any">any of the following</option>
        </Select>
      </label>
      <div className="condition-rows">
        {draft.conditions.map((condition, index) => (
          <ConditionRow
            key={index}
            condition={condition}
            sourceFields={fields}
            onChange={(next) => updateCondition(index, next)}
            onRemove={() => removeCondition(index)}
            removable={draft.conditions.length > 1}
            highlighted={danglingConditionIndexes?.has(index) ?? false}
          />
        ))}
      </div>
      <Button variant="ghost" className="add-question" disabled={draft.conditions.length >= 5} onClick={addCondition}>
        Add condition
      </Button>
      {draft.conditions.length >= 5 && <small>Up to 5 conditions</small>}

      <label className="match-select">
        <span>Then set Track</span>
        {tracks.length === 0 ? (
          <Select disabled value="">
            <option value="">Add tracks in Settings</option>
          </Select>
        ) : (
          <Select value={draft.setTrackId ?? ""} onChange={(event) => onChange({ ...draft, setTrackId: event.target.value ? (event.target.value as RoutingRuleInput["setTrackId"]) : null })}>
            <option value="">No track</option>
            {tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
          </Select>
        )}
      </label>

      <label className="match-select">
        <span>Add tags</span>
        {tags.length === 0 ? (
          <small>No tags yet — add tags in Settings.</small>
        ) : (
          <div className="condition-row__chips chip-picker" role="group" aria-label="Add tags">
            {tags.map((tag) => {
              const selected = draft.addTagIds.includes(tag.id);
              return (
                <button
                  type="button"
                  key={tag.id}
                  className={selected ? "chip chip--selected" : "chip"}
                  onClick={() => onChange({ ...draft, addTagIds: selected ? draft.addTagIds.filter((id) => id !== tag.id) : [...draft.addTagIds, tag.id] })}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        )}
      </label>

      <div className="inline-setting">
        <div><b>Enabled</b><small>Disabled rules are never matched.</small></div>
        <Switch label="Routing rule enabled" checked={draft.enabled} onClick={() => onChange({ ...draft, enabled: !draft.enabled })} />
      </div>
    </div>
  );
}
