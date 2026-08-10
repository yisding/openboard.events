"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, FileText, MapPin, Presentation, Search } from "lucide-react";
import { useState } from "react";
import type { ResourcePageRow } from "../server/queries";

const ICONS = [BookOpen, Presentation, MapPin];

/**
 * `pages` arrives already `publishedOnly`-filtered and event-scoped by the
 * server query — this component never re-derives that gate, it only searches
 * within what the server already decided the viewer may see (R4).
 */
export function PortalResourceList({ eventSlug, pages }: { eventSlug: string; pages: ResourcePageRow[] }) {
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const filtered = term ? pages.filter((page) => `${page.title} ${page.summary}`.toLowerCase().includes(term)) : pages;

  return (
    <div className="portal-container portal-page">
      <header className="portal-page-header">
        <span className="public-eyebrow">SPEAKER HUB</span>
        <h1>Resources</h1>
        <p>Guides and event information from the organizing team.</p>
      </header>

      {pages.length > 0 && (
        <label className="portal-resource-search">
          <Search size={18} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search resources" aria-label="Search resources" />
        </label>
      )}

      <div className="portal-resource-grid">
        {filtered.map((page, index) => {
          const Icon = ICONS[index % ICONS.length] ?? FileText;
          return (
            <Link href={`/portal/${eventSlug}/resources/${page.slug}`} key={page.id}>
              <span><Icon size={23} /></span>
              <small>GUIDE</small>
              <h2>{page.title}</h2>
              <p>{page.summary}</p>
              <b>Read guide <ArrowRight size={14} /></b>
            </Link>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="empty-state">
          <h3>{pages.length === 0 ? "No resources have been published yet." : "No resources match your search"}</h3>
        </div>
      )}
    </div>
  );
}
