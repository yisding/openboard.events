"use client";

import { Calendar, ChevronDown, Clipboard, ExternalLink, Grid3x3, Link2, ListChecks, MonitorSmartphone, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { RoomDTO, SessionFormatDTO, TrackDTO } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { Button, Field, PageHeader, Segmented, Switch } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { embedFiltersEqual, embedStylesEqual, hasUnsavedEmbedSettings } from "./embed-config-dirty";
import { sanitizeEmbedFilters, type EmbedFilterVocabulary } from "./embed-filter-state";
import { embedConfigDtoSchema, type CanonicalEmbedContentType, type EmbedConfigDTO, type EmbedFilters, type EmbedStyle } from "./embed-config-types";
import { autoResizeEmbedSnippet, fixedHeightEmbedSnippet } from "./embed-snippets";
import { ACCENT_HEX_RE, DEFAULT_BRAND_COLOR } from "@/shared/lib/brand-color";

type ResolvedEmbedStyle = { accent: string; theme: "light" | "dark"; showHeader: boolean };
const DEFAULT_STYLE: ResolvedEmbedStyle = { accent: DEFAULT_BRAND_COLOR, theme: "light", showHeader: true };

const TYPE_META: Record<CanonicalEmbedContentType, { label: string; route: string; description: string; icon: typeof MonitorSmartphone }> = {
  session_list: { label: "Sessions list", route: "sessions", description: "Searchable session cards with Track/Format/Location filters.", icon: ListChecks },
  agenda: { label: "Agenda", route: "agenda", description: "Day/time/room agenda with day navigation.", icon: Calendar },
  schedule_itinerary: { label: "Schedule itinerary", route: "itinerary", description: "Anonymous star-your-sessions itinerary with calendar export.", icon: MonitorSmartphone },
  speaker_list: { label: "Speakers list", route: "speakers", description: "Compact, surname-sorted speaker directory.", icon: Users },
  speaker_gallery: { label: "Speaker gallery", route: "gallery", description: "Photo-grid speaker gallery with full profiles.", icon: Grid3x3 },
};

// Session-shaped surfaces take track/format/room id filters and a
// description toggle; speaker-shaped surfaces take company/bio toggles only.
const SESSION_SHAPED = new Set<CanonicalEmbedContentType>(["agenda", "session_list", "schedule_itinerary"]);

function withDefaults(style: EmbedStyle): ResolvedEmbedStyle {
  return { accent: style.accent ?? DEFAULT_STYLE.accent, theme: style.theme ?? DEFAULT_STYLE.theme, showHeader: style.showHeader ?? DEFAULT_STYLE.showHeader };
}

/**
 * A native colour well accepts `#rrggbb` and nothing else — hand it `#abc` or
 * `#00a878ff` and the browser silently swaps in black. The hex field beside it
 * keeps the shorter and alpha forms; this is only what the well is shown.
 */
function colorWellValue(accent: string): string {
  if (!ACCENT_HEX_RE.test(accent)) return DEFAULT_BRAND_COLOR;
  const hex = accent.slice(1);
  if (hex.length <= 4) return `#${hex.slice(0, 3).replace(/./gu, (channel) => channel + channel)}`;
  return `#${hex.slice(0, 6)}`;
}

function toggleId(list: string[] | undefined, id: string): string[] {
  const current = list ?? [];
  return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
}

function FilterGroup({
  label, items, selected, onToggle,
}: {
  label: string;
  items: Array<{ id: string; name: string }>;
  selected: string[] | undefined;
  onToggle: (id: string) => void;
}) {
  const selectedCount = selected?.length ?? 0;
  return (
    <details className="embed-filter-group">
      <summary>
        <span><b>{label}</b><small>{selectedCount > 0 ? `${selectedCount} selected` : "All included"}</small></span>
        <ChevronDown size={15} />
      </summary>
      <div className="embed-filter-options" role="group" aria-label={`${label} included in embed`}>
        {items.map((item) => (
          <label key={item.id}>
            <input type="checkbox" checked={!!selected?.includes(item.id)} onChange={() => onToggle(item.id)} />
            <span>{item.name}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

/** One card per canonical content type, each its own kill switch + staged style/filters + save, per M33/M53 work orders. */
export function EmbedsAdminPage({
  eventId, eventSlug, eventName, initialConfigs, tracks, formats, rooms,
}: {
  eventId: string; eventSlug: string; eventName: string; initialConfigs: EmbedConfigDTO[];
  tracks: TrackDTO[]; formats: SessionFormatDTO[]; rooms: RoomDTO[];
}) {
  const { toast } = useToast();
  const filterVocabulary: EmbedFilterVocabulary = {
    trackIds: new Set(tracks.map((track) => track.id)),
    formatIds: new Set(formats.map((format) => format.id)),
    roomIds: new Set(rooms.map((room) => room.id)),
  };
  const [configs, setConfigs] = useState(initialConfigs);
  const [styleDrafts, setStyleDrafts] = useState<Record<CanonicalEmbedContentType, EmbedStyle>>(
    () => Object.fromEntries(initialConfigs.map((config) => [config.contentType, config.style])) as Record<CanonicalEmbedContentType, EmbedStyle>,
  );
  const [filterDrafts, setFilterDrafts] = useState<Record<CanonicalEmbedContentType, EmbedFilters>>(
    () => Object.fromEntries(initialConfigs.map((config) => [
      config.contentType,
      sanitizeEmbedFilters(config.filters, filterVocabulary),
    ])) as Record<CanonicalEmbedContentType, EmbedFilters>,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [openConfigId, setOpenConfigId] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState<{ contentType: CanonicalEmbedContentType; label: string; value: string } | null>(null);
  const hasUnsavedSettings = hasUnsavedEmbedSettings(configs, styleDrafts, filterDrafts);

  useUnsavedWorkGuard(hasUnsavedSettings);

  useEffect(() => setOrigin(window.location.origin), []);

  function styleFor(contentType: CanonicalEmbedContentType): EmbedStyle {
    return styleDrafts[contentType] ?? {};
  }
  function setStyleDraft(contentType: CanonicalEmbedContentType, patch: EmbedStyle) {
    setStyleDrafts((prev) => ({ ...prev, [contentType]: { ...prev[contentType], ...patch } }));
  }
  function filtersFor(contentType: CanonicalEmbedContentType): EmbedFilters {
    return filterDrafts[contentType] ?? {};
  }
  function setFilterDraft(contentType: CanonicalEmbedContentType, patch: EmbedFilters) {
    setFilterDrafts((prev) => ({ ...prev, [contentType]: { ...prev[contentType], ...patch } }));
  }

  async function patch(config: EmbedConfigDTO, body: { enabled?: boolean; style?: EmbedStyle; filters?: EmbedFilters }): Promise<EmbedConfigDTO | null> {
    setBusy(config.id);
    try {
      const updated = await api(`embeds/${eventId}/${config.id}`, embedConfigDtoSchema, { method: "PATCH", body });
      setConfigs((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      return updated;
    } catch {
      toast("That change could not be saved", { kind: "error" });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function toggleEnabled(config: EmbedConfigDTO) {
    const updated = await patch(config, { enabled: !config.enabled });
    if (updated) toast(updated.enabled ? `${TYPE_META[config.contentType].label} embed enabled` : `${TYPE_META[config.contentType].label} embed disabled`);
  }

  async function saveSettings(config: EmbedConfigDTO) {
    // Style and content filters are both read live from this saved row by
    // the embed routes. An already-placed iframe picks up appearance,
    // filtering, and field-visibility changes after this save.
    const filters = sanitizeEmbedFilters(filtersFor(config.contentType), filterVocabulary);
    setFilterDrafts((current) => ({ ...current, [config.contentType]: filters }));
    const updated = await patch(config, { style: styleFor(config.contentType), filters });
    if (updated) toast("Embed settings saved");
  }

  function iframeSnippet(contentType: CanonicalEmbedContentType): string {
    const { route } = TYPE_META[contentType];
    return fixedHeightEmbedSnippet({ origin, eventSlug, route, title: `${eventName} — ${TYPE_META[contentType].label}` });
  }

  function scriptSnippet(contentType: CanonicalEmbedContentType): string {
    const { route } = TYPE_META[contentType];
    return autoResizeEmbedSnippet({ origin, eventSlug, route, title: `${eventName} — ${TYPE_META[contentType].label}` });
  }

  function shareUrl(contentType: CanonicalEmbedContentType): string {
    return `${origin}/e/${eventSlug}/${TYPE_META[contentType].route}`;
  }

  async function copyText(contentType: CanonicalEmbedContentType, value: string, success: string, label: string) {
    if (!origin) return;
    try {
      await navigator.clipboard.writeText(value);
      setManualCopy(null);
      toast(success);
    } catch {
      setManualCopy({ contentType, label, value });
      toast("Copy failed — use the manual copy field below", { kind: "error" });
    }
  }

  function copyIframe(contentType: CanonicalEmbedContentType) {
    void copyText(contentType, iframeSnippet(contentType), "Fixed-height iframe copied", "fixed-height iframe code");
  }
  function copyScript(contentType: CanonicalEmbedContentType) {
    void copyText(contentType, scriptSnippet(contentType), `${TYPE_META[contentType].label} auto-resizing embed copied`, "auto-resizing embed code");
  }
  function copyShareUrl(contentType: CanonicalEmbedContentType) {
    void copyText(contentType, shareUrl(contentType), "Direct share URL copied", "share URL");
  }

  return (
    <div className="page embeds-admin-page">
      <PageHeader eyebrow="ENGAGE" title="Embeds" description="Put your live sessions, agenda, itinerary, and speakers on any website." />
      <section className="panel embed-overview" aria-label="Embed status">
        <span className="summary-icon accent"><MonitorSmartphone size={20} /></span>
        <div><strong>{configs.filter((config) => config.enabled).length} of {configs.length} embeds live</strong><p>Open a surface to tailor its appearance, content, and install code.</p></div>
        <span className="embed-overview-hint">Changes update existing embeds after you save.</span>
      </section>
      <section className="embed-cards">
        {configs.map((config) => {
          const meta = TYPE_META[config.contentType];
          const styleDraft = styleFor(config.contentType);
          const style = withDefaults(styleDraft);
          const filters = filtersFor(config.contentType);
          const Icon = meta.icon;
          const sessionShaped = SESSION_SHAPED.has(config.contentType);
          const accentText = style.accent;
          const accentValid = ACCENT_HEX_RE.test(accentText);
          const settingsDirty = !embedStylesEqual(styleDraft, config.style)
            || !embedFiltersEqual(filters, config.filters);
          const open = openConfigId === config.id;
          return (
            <article className={`panel embed-card ${open ? "is-open" : ""} ${config.enabled ? "" : "is-disabled"}`} key={config.id}>
              <header className="embed-card-header">
                <span className="summary-icon accent"><Icon size={20} /></span>
                <div className="embed-card-heading">
                  <div>
                    <h2>{meta.label}</h2>
                    {settingsDirty && <span className="embed-status is-unsaved">Unsaved</span>}
                  </div>
                  <p>{meta.description}</p>
                </div>
                <div className="embed-card-header-actions">
                  <div className="embed-enable-control">
                    <span className={`embed-publish-state ${config.enabled ? "is-enabled" : ""}`}><i />{config.enabled ? "Live" : "Off"}</span>
                    <Switch
                      label={`${meta.label} embed`}
                      checked={config.enabled}
                      disabled={busy !== null}
                      onClick={() => void toggleEnabled(config)}
                    />
                  </div>
                  <div className="embed-card-links">
                    <Button size="sm" variant="secondary" aria-expanded={open} aria-controls={`embed-settings-${config.id}`} onClick={() => setOpenConfigId(open ? null : config.id)}>
                      {open ? "Done" : "Edit settings"}<ChevronDown className={open ? "is-open" : ""} size={14} />
                    </Button>
                    <a className="button button-ghost button-sm" href={`/embed/${eventSlug}/${meta.route}`} target="_blank" rel="noreferrer">Open <ExternalLink size={14} /></a>
                  </div>
                </div>
              </header>

              {open && <div className="embed-editor" id={`embed-settings-${config.id}`}>
              <div className="embed-editor-bar">
                <div className={`embed-draft-state ${settingsDirty ? "is-dirty" : ""}`} aria-live="polite">
                  <i />
                  <span><b>{settingsDirty ? "Unsaved changes" : "Everything is saved"}</b><small>{settingsDirty ? "Save to update the live embed." : "The preview shows your published settings."}</small></span>
                </div>
                {/* An accent the renderer would discard is caught here rather than
                    saving cleanly and reverting to the default with no message. */}
                {settingsDirty && <Button size="sm" disabled={busy !== null || !accentValid} onClick={() => void saveSettings(config)}>{busy === config.id ? "Saving…" : "Save changes"}</Button>}
              </div>

              <div className="embed-editor-layout">
              <div className="embed-editor-controls">
              <div className="embed-settings-grid">
                <section className="embed-settings-section">
                  <header><h3>Appearance</h3><p>Match the host site without rebuilding the embed.</p></header>
                  <div className="form-stack">
                    <div className="field">
                      <span>Color theme</span>
                      <Segmented label={`${meta.label} color theme`} value={style.theme} onChange={(theme) => setStyleDraft(config.contentType, { theme: theme as "light" | "dark" })} items={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
                    </div>
                    <Field
                      label="Accent color"
                      group
                      hint="6-digit hex, for example #00a878"
                      hintId={`embed-accent-hint-${config.id}`}
                      error={accentValid ? undefined : "Use a hex color like #00a878"}
                      errorId={`embed-accent-error-${config.id}`}
                    >
                      <div className="color-input">
                        {/* The well and the hex field are one control: a well only
                            emits #rrggbb, so pasting an #rgba/#rrggbbaa value has
                            to go through the text side. */}
                        <input
                          type="color"
                          aria-label={`${meta.label} accent color picker`}
                          value={colorWellValue(accentText)}
                          onChange={(e) => setStyleDraft(config.contentType, { accent: e.target.value })}
                        />
                        <input
                          aria-label={`${meta.label} accent color hex value`}
                          aria-invalid={accentValid ? undefined : true}
                          aria-describedby={accentValid ? `embed-accent-hint-${config.id}` : `embed-accent-error-${config.id}`}
                          value={accentText}
                          onChange={(e) => setStyleDraft(config.contentType, { accent: e.target.value })}
                        />
                      </div>
                    </Field>
                    <div className="inline-setting">
                      <div><b>Show event header</b><small>Include the event name above content</small></div>
                      <Switch label={`${meta.label}: show event header`} checked={style.showHeader} disabled={busy !== null} onClick={() => setStyleDraft(config.contentType, { showHeader: !style.showHeader })} />
                    </div>
                  </div>
                </section>

                <section className="embed-settings-section">
                  <header><h3>Content</h3><p>Choose what visitors can see in this surface.</p></header>
                  <div className="form-stack">
                    {sessionShaped ? (
                      <div className="inline-setting">
                        <div><b>Show description</b><small>Include session descriptions in this embed</small></div>
                        <Switch label={`${meta.label}: show description`} checked={filters.fields?.description !== false} disabled={busy !== null}
                          onClick={() => setFilterDraft(config.contentType, { fields: { ...filters.fields, description: filters.fields?.description === false } })} />
                      </div>
                    ) : (
                      <>
                        <div className="inline-setting">
                          <div><b>Show company</b><small>Include job title and company</small></div>
                          <Switch label={`${meta.label}: show company`} checked={filters.fields?.speakerCompany !== false} disabled={busy !== null}
                            onClick={() => setFilterDraft(config.contentType, { fields: { ...filters.fields, speakerCompany: filters.fields?.speakerCompany === false } })} />
                        </div>
                        <div className="inline-setting">
                          <div><b>Show bio</b><small>Include the speaker&rsquo;s biography</small></div>
                          <Switch label={`${meta.label}: show bio`} checked={filters.fields?.speakerBio !== false} disabled={busy !== null}
                            onClick={() => setFilterDraft(config.contentType, { fields: { ...filters.fields, speakerBio: filters.fields?.speakerBio === false } })} />
                        </div>
                      </>
                    )}
                  </div>
                </section>
              </div>

              {sessionShaped && (tracks.length > 0 || formats.length > 0 || rooms.length > 0) && (
                <section className="embed-filters-section">
                  <header><h3>Limit what appears</h3><p>Everything is included by default. Open a group to choose specific values.</p></header>
                  <div className="embed-filter-grid">
                    {tracks.length > 0 && <FilterGroup label="Tracks" items={tracks} selected={filters.trackIds} onToggle={(id) => setFilterDraft(config.contentType, { trackIds: toggleId(filters.trackIds, id) })} />}
                    {formats.length > 0 && <FilterGroup label="Formats" items={formats} selected={filters.formatIds} onToggle={(id) => setFilterDraft(config.contentType, { formatIds: toggleId(filters.formatIds, id) })} />}
                    {rooms.length > 0 && <FilterGroup label="Locations" items={rooms} selected={filters.roomIds} onToggle={(id) => setFilterDraft(config.contentType, { roomIds: toggleId(filters.roomIds, id) })} />}
                  </div>
                </section>
              )}
              </div>

              <aside className="embed-editor-sidebar">
              <section className="embed-preview-section">
                <header>
                  <div><h3>Saved preview</h3><p>{settingsDirty ? "Save your changes to refresh this preview." : config.enabled ? "This is what visitors see now." : "This embed is currently switched off."}</p></div>
                  <a href={`/embed/${eventSlug}/${meta.route}`} target="_blank" rel="noreferrer" aria-label={`Open ${meta.label} preview in a new tab`}><ExternalLink size={14} /></a>
                </header>
                <div className="embed-preview-frame">
                  <div className="embed-preview-chrome"><i /><i /><i /><span>{eventSlug}/{meta.route}</span></div>
                  <iframe
                    key={`${config.id}-${JSON.stringify(config.style)}-${JSON.stringify(config.filters)}-${config.enabled}`}
                    src={`/embed/${eventSlug}/${meta.route}`}
                    title={`${meta.label} saved preview`}
                    loading="lazy"
                  />
                </div>
              </section>
              </aside>
              </div>

              <section className="embed-install-section">
                <header><h3>Install</h3><p>Recommended: the loader resizes automatically as the schedule or screen width changes.</p></header>
                <div className="embed-code">
                  <code>{origin ? scriptSnippet(config.contentType) : `<script src="…/embed.js" …>`}</code>
                  <button type="button" disabled={!origin} aria-label={`Copy ${meta.label} auto-resizing embed code`} onClick={() => copyScript(config.contentType)}><Clipboard size={15} /></button>
                </div>
                <footer>
                  <Button variant="secondary" disabled={!origin} onClick={() => copyScript(config.contentType)}><Clipboard size={15} /> Copy auto-resizing embed</Button>
                  <Button variant="ghost" disabled={!origin} onClick={() => copyIframe(config.contentType)}>Copy fixed-height iframe</Button>
                  <Button variant="ghost" disabled={!origin} onClick={() => copyShareUrl(config.contentType)}><Link2 size={13} /> Copy share URL</Button>
                </footer>
                {manualCopy?.contentType === config.contentType && (
                  <div className="embed-manual-copy" role="alert">
                    <div>
                      <b>Copy {manualCopy.label} manually</b>
                      <button type="button" onClick={() => setManualCopy(null)}>Close</button>
                    </div>
                    <textarea
                      aria-label={`${meta.label} ${manualCopy.label}`}
                      readOnly
                      value={manualCopy.value}
                      onFocus={(event) => event.currentTarget.select()}
                      onClick={(event) => event.currentTarget.select()}
                    />
                    <small>Click or tap the field to select the complete value.</small>
                  </div>
                )}
              </section>
              </div>}
            </article>
          );
        })}
      </section>
    </div>
  );
}
