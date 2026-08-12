"use client";

import { Calendar, Check, ChevronDown, Clipboard, ExternalLink, Grid3x3, Link2, ListChecks, MonitorSmartphone, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { RoomDTO, SessionFormatDTO, TrackDTO } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { Button, PageHeader, Segmented, Switch } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { embedFiltersEqual, embedStylesEqual } from "./embed-config-dirty";
import { sanitizeEmbedFilters, type EmbedFilterVocabulary } from "./embed-filter-state";
import { embedConfigDtoSchema, type CanonicalEmbedContentType, type EmbedConfigDTO, type EmbedFilters, type EmbedStyle } from "./embed-config-types";
import { DEFAULT_BRAND_COLOR } from "@/shared/lib/brand-color";

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

function toQuery(style: EmbedStyle): string {
  const merged = withDefaults(style);
  return `theme=${merged.theme}&header=${merged.showHeader ? 1 : 0}&accent=${encodeURIComponent(merged.accent)}`;
}

function toggleId(list: string[] | undefined, id: string): string[] {
  const current = list ?? [];
  return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
}

/** One card per canonical content type, each its own kill switch + staged style/filters + save, per M33/M53 work orders. */
export function EmbedsAdminPage({
  eventId, eventSlug, initialConfigs, tracks, formats, rooms,
}: {
  eventId: string; eventSlug: string; initialConfigs: EmbedConfigDTO[];
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
  const [openConfigId, setOpenConfigId] = useState<string | null>(initialConfigs[0]?.id ?? null);
  const [manualCopy, setManualCopy] = useState<{ contentType: CanonicalEmbedContentType; label: string; value: string } | null>(null);

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
    // the embed routes (the query string on the copied iframe/script
    // snippets is a display convenience for a human skimming the tag; the
    // routes themselves never read it) — an already-placed iframe picks up
    // a style or filter/field-visibility change right after this save.
    const filters = sanitizeEmbedFilters(filtersFor(config.contentType), filterVocabulary);
    setFilterDrafts((current) => ({ ...current, [config.contentType]: filters }));
    const updated = await patch(config, { style: styleFor(config.contentType), filters });
    if (updated) toast("Embed settings saved");
  }

  function iframeSnippet(contentType: CanonicalEmbedContentType): string {
    const { route } = TYPE_META[contentType];
    return `<iframe src="${origin}/embed/${eventSlug}/${route}?${toQuery(styleFor(contentType))}" width="100%" height="760" style="border:0" loading="lazy" title="${eventSlug} ${route}"></iframe>`;
  }

  function scriptSnippet(contentType: CanonicalEmbedContentType): string {
    const { route } = TYPE_META[contentType];
    return `<script src="${origin}/embed.js" data-event="${eventSlug}" data-type="${route}" data-params="${toQuery(styleFor(contentType))}" async></script>`;
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
    void copyText(contentType, iframeSnippet(contentType), `${TYPE_META[contentType].label} iframe snippet copied`, "iframe code");
  }
  function copyScript(contentType: CanonicalEmbedContentType) {
    void copyText(contentType, scriptSnippet(contentType), "Auto-resize script copied", "auto-resize script");
  }
  function copyShareUrl(contentType: CanonicalEmbedContentType) {
    void copyText(contentType, shareUrl(contentType), "Direct share URL copied", "share URL");
  }

  return (
    <main className="page embeds-admin-page">
      <PageHeader eyebrow="ENGAGE" title="Embeds" description="Put your live sessions, agenda, itinerary, and speakers on any website." />
      <section className="embed-cards">
        {configs.map((config) => {
          const meta = TYPE_META[config.contentType];
          const styleDraft = styleFor(config.contentType);
          const style = withDefaults(styleDraft);
          const filters = filtersFor(config.contentType);
          const Icon = meta.icon;
          const sessionShaped = SESSION_SHAPED.has(config.contentType);
          const settingsDirty = !embedStylesEqual(styleDraft, config.style)
            || !embedFiltersEqual(filters, config.filters);
          const open = openConfigId === config.id;
          return (
            <article className={`panel embed-card ${config.enabled ? "" : "is-disabled"}`} key={config.id}>
              <header className="embed-card-header">
                <span className="summary-icon accent"><Icon size={20} /></span>
                <div className="embed-card-heading">
                  <div>
                    <h2>{meta.label}</h2>
                    <span className={`embed-status ${config.enabled ? "is-enabled" : ""}`}>{config.enabled ? "Live" : "Off"}</span>
                    {settingsDirty && <span className="embed-status is-unsaved">Unsaved</span>}
                  </div>
                  <p>{meta.description}</p>
                </div>
                <div className="embed-card-header-actions">
                  <div className="embed-card-links">
                    <Button size="sm" variant="secondary" aria-expanded={open} aria-controls={`embed-settings-${config.id}`} onClick={() => setOpenConfigId(open ? null : config.id)}>
                      {open ? "Close" : "Customize"}<ChevronDown className={open ? "is-open" : ""} size={14} />
                    </Button>
                    <a className="button button-ghost button-sm" href={`/embed/${eventSlug}/${meta.route}?${toQuery(styleDraft)}`} target="_blank" rel="noreferrer">Preview <ExternalLink size={14} /></a>
                  </div>
                  <div className="embed-enable-control">
                    <span>{config.enabled ? "Enabled" : "Disabled"}</span>
                    <Switch
                      label={`${meta.label} embed`}
                      checked={config.enabled}
                      disabled={busy !== null}
                      onClick={() => void toggleEnabled(config)}
                    />
                  </div>
                </div>
              </header>

              {open && <div id={`embed-settings-${config.id}`}>
              <div className="embed-settings-grid">
                <section className="embed-settings-section">
                  <header><h3>Appearance</h3><p>Match the host site without rebuilding the embed.</p></header>
                  <div className="form-stack">
                    <div className="field">
                      <span>Color theme</span>
                      <Segmented label={`${meta.label} color theme`} value={style.theme} onChange={(theme) => setStyleDraft(config.contentType, { theme: theme as "light" | "dark" })} items={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
                    </div>
                    <label className="field">
                      <span>Accent color</span>
                      <div className="color-input">
                        <i style={{ background: style.accent }} />
                        <input value={style.accent} onChange={(e) => setStyleDraft(config.contentType, { accent: e.target.value })} />
                      </div>
                    </label>
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
                  <header><h3>Filters</h3><p>Leave a group empty to include every value.</p></header>
                  <div className="embed-filter-grid">
                    {tracks.length > 0 && (
                      <fieldset className="embed-filter-group">
                        <legend>Tracks {filters.trackIds && filters.trackIds.length > 0 ? `· ${filters.trackIds.length} selected` : "· All"}</legend>
                        {tracks.map((track) => (
                          <label key={track.id}>
                            <input type="checkbox" checked={!!filters.trackIds?.includes(track.id)} onChange={() => setFilterDraft(config.contentType, { trackIds: toggleId(filters.trackIds, track.id) })} />
                            <span>{track.name}</span>
                          </label>
                        ))}
                      </fieldset>
                    )}
                    {formats.length > 0 && (
                      <fieldset className="embed-filter-group">
                        <legend>Formats {filters.formatIds && filters.formatIds.length > 0 ? `· ${filters.formatIds.length} selected` : "· All"}</legend>
                        {formats.map((format) => (
                          <label key={format.id}>
                            <input type="checkbox" checked={!!filters.formatIds?.includes(format.id)} onChange={() => setFilterDraft(config.contentType, { formatIds: toggleId(filters.formatIds, format.id) })} />
                            <span>{format.name}</span>
                          </label>
                        ))}
                      </fieldset>
                    )}
                    {rooms.length > 0 && (
                      <fieldset className="embed-filter-group">
                        <legend>Locations {filters.roomIds && filters.roomIds.length > 0 ? `· ${filters.roomIds.length} selected` : "· All"}</legend>
                        {rooms.map((room) => (
                          <label key={room.id}>
                            <input type="checkbox" checked={!!filters.roomIds?.includes(room.id)} onChange={() => setFilterDraft(config.contentType, { roomIds: toggleId(filters.roomIds, room.id) })} />
                            <span>{room.name}</span>
                          </label>
                        ))}
                      </fieldset>
                    )}
                  </div>
                </section>
              )}

              <div className="embed-save-row">
                <span aria-live="polite">{settingsDirty ? "Unsaved settings" : "Settings up to date"}</span>
                <Button disabled={busy !== null || !settingsDirty} onClick={() => void saveSettings(config)}><Check size={16} /> {busy === config.id ? "Saving…" : "Save settings"}</Button>
              </div>

              <section className="embed-install-section">
                <header><h3>Install</h3><p>Use the iframe anywhere, or the script when the host page should resize automatically.</p></header>
                <div className="embed-code">
                  <code>{`<iframe src="${origin || "…"}/embed/${eventSlug}/${meta.route}?…" …>`}</code>
                  <button type="button" disabled={!origin} aria-label={`Copy ${meta.label} embed code`} onClick={() => copyIframe(config.contentType)}><Clipboard size={15} /></button>
                </div>
                <footer>
                  <Button variant="secondary" disabled={!origin} onClick={() => copyIframe(config.contentType)}><Clipboard size={15} /> Copy iframe</Button>
                  <Button variant="ghost" disabled={!origin} onClick={() => copyScript(config.contentType)}>Copy auto-resize script</Button>
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
    </main>
  );
}
