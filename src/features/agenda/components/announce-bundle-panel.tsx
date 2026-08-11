"use client";

import { Check, Clipboard, Megaphone, Share2 } from "lucide-react";
import { useState } from "react";
import type { AnnounceBundle } from "../server/announce";
import { Button, Modal } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

/**
 * M60 — "The 'ready to announce' bundle... in one place." Only rendered by
 * the caller once `bundle.hasPublishedSchedule` is true; everything inside
 * is copy-to-clipboard, not another mutation — the moment this exists is
 * the schedule publish that already happened.
 */
function CopyRow({ label, value }: { label: string; value: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <div className="announce-copy-row">
      <div>
        <b>{label}</b>
        <code>{value}</code>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          toast(`${label} copied`);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={14} /> : <Clipboard size={14} />} Copy
      </Button>
    </div>
  );
}

export function AnnounceBundleTrigger({ bundle }: { bundle: AnnounceBundle | null }) {
  const [open, setOpen] = useState(false);
  if (!bundle?.hasPublishedSchedule) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Megaphone size={16} /> Ready to announce
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Ready to announce" description="Everything for the announcement, in one place." wide>
        <div className="announce-bundle">
          <section>
            <h3>Announcement copy</h3>
            <CopyRow label="Suggested post" value={bundle.announcementCopy} />
          </section>
          <section>
            <h3>Public pages</h3>
            <CopyRow label="Agenda" value={bundle.publicUrls.agenda} />
            <CopyRow label="Sessions" value={bundle.publicUrls.sessions} />
            <CopyRow label="Speakers" value={bundle.publicUrls.speakers} />
            <CopyRow label="Gallery" value={bundle.publicUrls.gallery} />
            <CopyRow label="My Schedule" value={bundle.publicUrls.itinerary} />
          </section>
          <section>
            <h3>Embed snippet</h3>
            <CopyRow label="Agenda embed" value={bundle.embedSnippet} />
          </section>
          {bundle.speakerLinks.length > 0 && (
            <section>
              <h3><Share2 size={14} /> Per-speaker share cards</h3>
              <p className="announce-bundle-note">Each speaker&rsquo;s own &ldquo;I&rsquo;m speaking!&rdquo; page — forward these along with the announcement.</p>
              <ul className="announce-speaker-links">
                {bundle.speakerLinks.map((link) => (
                  <li key={link.contactId}>
                    {link.shareUrl
                      ? <CopyRow label={link.name} value={link.shareUrl} />
                      : <span className="announce-speaker-unavailable">{link.name} <small>not available — configure share links to enable this</small></span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </Modal>
    </>
  );
}
