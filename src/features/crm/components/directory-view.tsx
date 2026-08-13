"use client";

import { Building2, Contact, GitMerge, Mail, Plus, Search, Tags, Upload, Users, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { OrganizationEventRow } from "@/features/organizations";
import { loadBulkSendRecovery, type BulkSendRecoverySnapshot } from "@/features/comms/bulk-send-recovery";
import { UnreadableBulkSendRecovery } from "@/features/comms/components/unreadable-bulk-send-recovery";
import {
  CRM_CONTACT_SOURCES,
  CRM_PIPELINE_STAGES,
  type CrmContactSource,
  type CrmMetricsDTO,
  type CrmPipelineStage,
  type CrmTagDTO,
  type OrganizationContactSummaryDTO,
  type OrganizationId,
} from "@/shared/contracts";
import { DataTable } from "@/shared/ui/app/data-table";
import { BulkActionBar } from "@/shared/ui/app/bulk-action-bar";
import { Dash } from "@/shared/ui/app/dash";
import { Avatar, Button, EmptyState, PageHeader, Select } from "@/shared/ui/ui-kit";
import { CrmNav } from "./crm-nav";
import { ContactCreateDialog } from "./contact-create-dialog";
import { CrmImportDialog } from "./crm-import-dialog";
import { CrmBulkEmailDialog } from "./crm-bulk-email-dialog";
import { MergeWizardDialog } from "./merge-wizard-dialog";

function initialsFor(row: OrganizationContactSummaryDTO): string {
  const parts = `${row.firstName} ${row.lastName}`.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return row.email.slice(0, 2).toUpperCase();
}

function nameOf(row: OrganizationContactSummaryDTO): string {
  return `${row.firstName} ${row.lastName}`.trim() || row.email;
}

/**
 * M55 — the organization-wide speaker directory: search/filter across every
 * event's linked contacts (AC), tag/pipeline/event-link filters, manual add,
 * CSV import, and bulk verbs (email selected, merge exactly two selected —
 * the `experience-design.md` "bulk verbs on every list" pattern this repo's
 * other lists already use). Filters live in the URL like `SpeakersAdminView`
 * does one scope down, so the server page re-fetches on every change and the
 * back button and a shared link both do what they look like they do.
 */
export function DirectoryView({
  organizationId,
  rows,
  total,
  page,
  pageSize,
  search,
  tagIds,
  pipelineStage,
  source,
  hasEventLink,
  eventId,
  tags,
  events,
  metrics,
}: {
  organizationId: OrganizationId;
  rows: OrganizationContactSummaryDTO[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  tagIds: string[];
  pipelineStage: CrmPipelineStage | null;
  source: CrmContactSource | null;
  hasEventLink: boolean | null;
  eventId: string | null;
  tags: CrmTagDTO[];
  events: OrganizationEventRow[];
  metrics: CrmMetricsDTO;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [draftSearch, setDraftSearch] = useState(search);
  useEffect(() => setDraftSearch(search), [search]);
  const [selected, setSelected] = useState<OrganizationContactSummaryDTO[]>([]);
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailRecovery, setEmailRecovery] = useState<BulkSendRecoverySnapshot | null>(null);
  const [emailRecoveryUnreadable, setEmailRecoveryUnreadable] = useState(false);
  useEffect(() => {
    setEmailRecovery(null);
    setEmailRecoveryUnreadable(false);
    const loaded = loadBulkSendRecovery(window.sessionStorage, { surface: "crm", scope: organizationId });
    if (loaded.ok) setEmailRecovery(loaded.snapshot);
    else if (loaded.reason === "corrupt" || loaded.reason === "identity_mismatch") setEmailRecoveryUnreadable(true);
  }, [organizationId]);
  const [mergeOpen, setMergeOpen] = useState(false);

  function openBulkEmail(selectedRows: OrganizationContactSummaryDTO[]) {
    const loaded = loadBulkSendRecovery(window.sessionStorage, { surface: "crm", scope: organizationId });
    if (!loaded.ok && (loaded.reason === "corrupt" || loaded.reason === "identity_mismatch")) {
      setEmailRecoveryUnreadable(true);
      return;
    }
    if (loaded.ok) setEmailRecovery(loaded.snapshot);
    setSelected(selectedRows);
    setEmailOpen(true);
  }

  const setParams = (patch: Record<string, string | null>, resetPage = true) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") query.delete(key);
      else query.set(key, value);
    }
    if (resetPage) query.delete("page");
    router.push(`?${query.toString()}`);
  };

  function toggleTag(tagId: string) {
    const next = tagIds.includes(tagId) ? tagIds.filter((id) => id !== tagId) : [...tagIds, tagId];
    setParams({ tagIds: next.length > 0 ? next.join(",") : null });
  }

  const columns = useMemo<Array<ColumnDef<OrganizationContactSummaryDTO, unknown>>>(() => [
    {
      id: "contact",
      header: "Contact",
      accessorFn: (row) => nameOf(row),
      cell: ({ row }) => (
        <div className="speaker-table-person">
          <Avatar initials={initialsFor(row.original)} size="sm" />
          <div className="speaker-table-person-copy">
            <b>{nameOf(row.original)}</b>
            <span>{row.original.jobTitle ?? ""}{row.original.jobTitle && row.original.company ? " · " : ""}{row.original.company ?? ""}</span>
            <small>{row.original.email}</small>
          </div>
        </div>
      ),
    },
    {
      id: "tags",
      header: "Tags",
      enableSorting: false,
      cell: ({ row }) => row.original.tags.length === 0 ? <Dash /> : (
        <div className="chip-picker">
          {row.original.tags.map((tag) => <span key={tag.id} className="chip">{tag.name}</span>)}
        </div>
      ),
    },
    {
      id: "events",
      header: "Events",
      accessorKey: "eventCount",
      cell: ({ row }) => <span className="session-count">{row.original.eventCount}</span>,
    },
    {
      id: "source",
      header: "Source",
      accessorKey: "source",
      cell: ({ row }) => <span style={{ color: "var(--muted)", fontSize: 11, textTransform: "capitalize" }}>{row.original.source.replaceAll("_", " ")}</span>,
    },
    {
      id: "lastActivityAt",
      header: "Last activity",
      accessorKey: "lastActivityAt",
      cell: ({ row }) => row.original.lastActivityAt ? <span className="table-date">{new Date(row.original.lastActivityAt).toLocaleDateString()}</span> : <Dash />,
    },
  ], []);

  return (
    <main className="page">
      <PageHeader
        eyebrow="ORGANIZATION"
        title="Speaker CRM"
        description="Every contact this organization has ever worked with, across every event."
        actions={<>
          <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload size={15} /> Import CSV</Button>
          <Button onClick={() => setCreateOpen(true)}><Plus size={15} /> Add contact</Button>
        </>}
      />
      <CrmNav organizationId={organizationId} active="directory" />

      {emailRecovery && !emailOpen && <div className="notify-bar" role="status">
        <div><p>
          <b>{emailRecovery.confirmedResult ? "Completed CRM email needs cleanup" : "Unconfirmed CRM email"}</b>
          <small>{emailRecovery.confirmedResult ? "The send is complete. Reopen it to clear the saved browser recovery record." : "Resume the unchanged send to learn what queued without emailing anyone twice."}</small>
        </p></div>
        <Button size="sm" onClick={() => setEmailOpen(true)}>{emailRecovery.confirmedResult ? "Finish cleanup" : "Resume unconfirmed email"}</Button>
      </div>}
      {emailRecoveryUnreadable && <UnreadableBulkSendRecovery
        identity={{ surface: "crm", scope: organizationId }}
        onCleared={() => setEmailRecoveryUnreadable(false)}
      />}

      <section className="summary-row">
        <article><span className="summary-icon accent"><Contact size={19} /></span><div><strong>{metrics.totalContacts}</strong><small>Total contacts</small></div></article>
        <article><span className="summary-icon"><Users size={19} /></span><div><strong>{metrics.totalWithEventLink}</strong><small>Linked to an event</small></div></article>
        <article><span className="summary-icon"><Tags size={19} /></span><div><strong>{metrics.totalTagged}</strong><small>Tagged</small></div></article>
        <article><span className="summary-icon"><Building2 size={19} /></span><div><strong>{metrics.eventsRepresented}</strong><small>Events represented</small></div></article>
      </section>

      {tags.length > 0 && (
        <div className="chip-picker" style={{ marginBottom: 12 }}>
          {tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className={tagIds.includes(tag.id) ? "chip chip--selected" : "chip"}
              onClick={() => toggleTag(tag.id)}
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}

      <div className="abstract-status-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={!pipelineStage} className={!pipelineStage ? "active" : ""} onClick={() => setParams({ pipelineStage: null })}>All</button>
        {CRM_PIPELINE_STAGES.map((stage) => (
          <button key={stage} type="button" role="tab" aria-selected={pipelineStage === stage} className={pipelineStage === stage ? "active" : ""} onClick={() => setParams({ pipelineStage: pipelineStage === stage ? null : stage })}>
            {stage[0]?.toUpperCase()}{stage.slice(1)} pipeline
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={rows}
        columnVisibilityKey={`crm-directory:${organizationId}`}
        getRowId={(row) => row.id}
        onRowClick={(row) => router.push(`/organizations/${organizationId}/crm/${row.id}`)}
        enableSelection
        getRowLabel={nameOf}
        onSelectionChange={setSelected}
        renderSelectionBar={({ selectedRows, countLabel, clearSelection }) => (
          <BulkActionBar
            count={selectedRows.length}
            countLabel={countLabel}
            onClear={clearSelection}
            actions={<>
              <Button
                size="sm"
                disabled={emailRecoveryUnreadable}
                title={emailRecoveryUnreadable ? "Clear the unreadable email recovery before starting another send" : undefined}
                onClick={() => openBulkEmail(selectedRows)}
              ><Mail size={14} /> Email selected</Button>
              {selectedRows.length === 2 && <Button size="sm" variant="secondary" onClick={() => { setSelected(selectedRows); setMergeOpen(true); }}><GitMerge size={14} /> Merge selected</Button>}
            </>}
          />
        )}
        selectionEpoch={selectionEpoch}
        serverPagination={{ page, pageSize, total, onPageChange: (next) => setParams({ page: next > 1 ? String(next) : null }, false) }}
        toolbar={
          <>
            <form className="table-search" onSubmit={(event) => { event.preventDefault(); setParams({ search: draftSearch || null }); }}>
              <Search size={16} />
              <input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Search name, email, or company" aria-label="Search the directory" />
              {draftSearch && <button type="button" aria-label="Clear search" onClick={() => { setDraftSearch(""); setParams({ search: null }); }}><X size={14} /></button>}
            </form>
            <Select className="compact-select" aria-label="Filter by event" value={eventId ?? ""} onChange={(event) => setParams({ eventIds: event.target.value || null })}>
              <option value="">All events</option>
              {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
            </Select>
            <Select className="compact-select" aria-label="Filter by source" value={source ?? "all"} onChange={(event) => setParams({ source: event.target.value === "all" ? null : event.target.value })}>
              <option value="all">Every source</option>
              {CRM_CONTACT_SOURCES.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
            </Select>
            <label className="crm-unlinked-filter">
              <input type="checkbox" checked={hasEventLink === false} onChange={(event) => setParams({ hasEventLink: event.target.checked ? "false" : null })} />
              Not linked to an event yet
            </label>
            <span className="row-count">{total} shown</span>
          </>
        }
        empty={
          <EmptyState
            icon={<Contact size={20} />}
            title={search || tagIds.length > 0 || pipelineStage || hasEventLink !== null ? "Nothing matches these filters" : "No contacts yet"}
            description={search || tagIds.length > 0 || pipelineStage || hasEventLink !== null ? "Try clearing a filter or search term." : "Add a contact, import a CSV, or push a speaker in from an event to start the directory."}
          />
        }
      />

      <ContactCreateDialog organizationId={organizationId} open={createOpen} onClose={() => setCreateOpen(false)} />
      <CrmImportDialog organizationId={organizationId} open={importOpen} onClose={() => setImportOpen(false)} />
      {emailOpen && (
        <CrmBulkEmailDialog
          organizationId={organizationId}
          open={emailOpen}
          recipients={selected.map((row) => ({ id: row.id, name: nameOf(row), email: row.email }))}
          initialRecovery={emailRecovery}
          onRecoveryChange={setEmailRecovery}
          onClose={() => { setEmailOpen(false); setSelected([]); setSelectionEpoch((epoch) => epoch + 1); }}
        />
      )}
      {mergeOpen && selected.length === 2 && selected[0] && selected[1] && (
        <MergeWizardDialog
          organizationId={organizationId}
          open={mergeOpen}
          a={{ id: selected[0].id, label: nameOf(selected[0]), email: selected[0].email }}
          b={{ id: selected[1].id, label: nameOf(selected[1]), email: selected[1].email }}
          onClose={() => { setMergeOpen(false); setSelected([]); setSelectionEpoch((epoch) => epoch + 1); }}
        />
      )}
    </main>
  );
}
