"use client";

import { Check, Clipboard, ExternalLink, MonitorSmartphone, Palette } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/shared/lib/api-client";
import { Button, PageHeader, Segmented } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { embedConfigDtoSchema, type CanonicalEmbedContentType, type EmbedConfigDTO, type EmbedStyle } from "./embed-config-types";

type ResolvedEmbedStyle = { accent: string; theme: "light" | "dark"; showHeader: boolean };
const DEFAULT_STYLE: ResolvedEmbedStyle = { accent: "#00a878", theme: "light", showHeader: true };

const TYPE_META: Record<CanonicalEmbedContentType, { label: string; route: "schedule" | "speakers"; description: string; icon: typeof MonitorSmartphone }> = {
  schedule_itinerary: { label: "Schedule itinerary", route: "schedule", description: "Mobile-friendly agenda with live filters and calendar links.", icon: MonitorSmartphone },
  speaker_gallery: { label: "Speaker gallery", route: "speakers", description: "Responsive confirmed-speaker cards with session links.", icon: Palette },
};

function withDefaults(style: EmbedStyle): ResolvedEmbedStyle {
  return { accent: style.accent ?? DEFAULT_STYLE.accent, theme: style.theme ?? DEFAULT_STYLE.theme, showHeader: style.showHeader ?? DEFAULT_STYLE.showHeader };
}

function toQuery(style: EmbedStyle): string {
  const merged = withDefaults(style);
  return `theme=${merged.theme}&header=${merged.showHeader ? 1 : 0}&accent=${encodeURIComponent(merged.accent)}`;
}

/** One card per canonical content type, each its own kill switch + staged style + save, per M33 work order Step 6. */
export function EmbedsAdminPage({ eventId, eventSlug, initialConfigs }: { eventId: string; eventSlug: string; initialConfigs: EmbedConfigDTO[] }) {
  const { toast } = useToast();
  const [configs, setConfigs] = useState(initialConfigs);
  const [drafts, setDrafts] = useState<Record<CanonicalEmbedContentType, EmbedStyle>>(
    () => Object.fromEntries(initialConfigs.map((config) => [config.contentType, config.style])) as Record<CanonicalEmbedContentType, EmbedStyle>,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  function draftFor(contentType: CanonicalEmbedContentType): EmbedStyle {
    return drafts[contentType] ?? {};
  }

  function setDraft(contentType: CanonicalEmbedContentType, patch: EmbedStyle) {
    setDrafts((prev) => ({ ...prev, [contentType]: { ...prev[contentType], ...patch } }));
  }

  async function patch(config: EmbedConfigDTO, body: { enabled?: boolean; style?: EmbedStyle }): Promise<EmbedConfigDTO | null> {
    setBusy(config.id);
    try {
      const updated = await api(`embeds/${eventId}/${config.id}`, embedConfigDtoSchema, { method: "PATCH", body });
      setConfigs((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      return updated;
    } catch {
      toast("That change could not be saved");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function toggleEnabled(config: EmbedConfigDTO) {
    const updated = await patch(config, { enabled: !config.enabled });
    if (updated) toast(updated.enabled ? `${TYPE_META[config.contentType].label} embed enabled` : `${TYPE_META[config.contentType].label} embed disabled`);
  }

  async function saveStyle(config: EmbedConfigDTO) {
    const updated = await patch(config, { style: draftFor(config.contentType) });
    if (updated) toast("Embed appearance saved");
  }

  function iframeSnippet(contentType: CanonicalEmbedContentType): string {
    const { route } = TYPE_META[contentType];
    return `<iframe src="${origin}/embed/${eventSlug}/${route}?${toQuery(draftFor(contentType))}" width="100%" height="760" style="border:0" loading="lazy" title="${eventSlug} ${route}"></iframe>`;
  }

  function scriptSnippet(contentType: CanonicalEmbedContentType): string {
    const { route } = TYPE_META[contentType];
    return `<script src="${origin}/embed.js" data-event="${eventSlug}" data-type="${route}" data-params="${toQuery(draftFor(contentType))}" async></script>`;
  }

  function copyIframe(contentType: CanonicalEmbedContentType) {
    void navigator.clipboard.writeText(iframeSnippet(contentType));
    toast(`${TYPE_META[contentType].label} iframe snippet copied`);
  }

  function copyScript(contentType: CanonicalEmbedContentType) {
    void navigator.clipboard.writeText(scriptSnippet(contentType));
    toast("Auto-resize script copied");
  }

  return (
    <>
      <PageHeader eyebrow="ENGAGE" title="Embeds" description="Put your live schedule and speaker gallery on any website." />
      <section className="embed-cards">
        {configs.map((config) => {
          const meta = TYPE_META[config.contentType];
          const draft = draftFor(config.contentType);
          const style = withDefaults(draft);
          const Icon = meta.icon;
          return (
            <article className="panel embed-card" key={config.id}>
              <span className="summary-icon purple"><Icon size={20} /></span>
              <div>
                <h2>{meta.label}</h2>
                <p>{meta.description}</p>
              </div>
              <a href={`/embed/${eventSlug}/${meta.route}?${toQuery(draft)}`} target="_blank" rel="noreferrer">View embed <ExternalLink size={14} /></a>
              <div className="inline-setting">
                <div><b>Enabled</b><small>Turn off to blank this embed without breaking the host page</small></div>
                <button
                  type="button"
                  className={`switch ${config.enabled ? "on" : ""}`}
                  disabled={busy === config.id}
                  onClick={() => void toggleEnabled(config)}
                  aria-label={`${config.enabled ? "Disable" : "Enable"} ${meta.label} embed`}
                >
                  <i />
                </button>
              </div>
              <div className="form-stack">
                <label className="field">
                  <span>Color theme</span>
                  <Segmented value={style.theme} onChange={(theme) => setDraft(config.contentType, { theme: theme as "light" | "dark" })} items={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
                </label>
                <label className="field">
                  <span>Accent color</span>
                  <div className="color-input">
                    <i style={{ background: style.accent }} />
                    <input value={style.accent} onChange={(e) => setDraft(config.contentType, { accent: e.target.value })} />
                  </div>
                </label>
                <div className="inline-setting">
                  <div><b>Show event header</b><small>Include the event name above content</small></div>
                  <button type="button" className={`switch ${style.showHeader ? "on" : ""}`} onClick={() => setDraft(config.contentType, { showHeader: !style.showHeader })}><i /></button>
                </div>
                <Button variant="secondary" disabled={busy === config.id} onClick={() => void saveStyle(config)}><Check size={16} /> Save appearance</Button>
              </div>
              <div className="embed-code">
                <code>{`<iframe src="${origin || "…"}/embed/${eventSlug}/${meta.route}?…" …>`}</code>
                <button type="button" aria-label={`Copy ${meta.label} embed code`} onClick={() => copyIframe(config.contentType)}><Clipboard size={15} /></button>
              </div>
              <footer>
                <Button variant="secondary" onClick={() => copyIframe(config.contentType)}><Clipboard size={15} /> Copy iframe</Button>
                <Button variant="ghost" onClick={() => copyScript(config.contentType)}>Copy auto-resize script</Button>
              </footer>
            </article>
          );
        })}
      </section>
    </>
  );
}
