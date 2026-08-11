"use client";

import { Camera, CheckCircle2, Linkedin, LinkIcon, Twitter } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SpeakerProfileDTO } from "@/features/portal";
import { LIMITS, plainTextLength } from "@/shared/contracts";
import { FileUpload } from "@/shared/ui/app/file-upload";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { useToast } from "@/shared/ui/toast";
import { Avatar, Button, Field } from "@/shared/ui/ui-kit";

/** Empty on submit becomes null — an unset link, not a link to the empty string. */
function nullIfBlank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

type Payload = {
  bioHtml?: string;
  salutation?: string;
  honorific?: string;
  firstName?: string;
  lastName?: string;
  pronouns?: string;
  gender?: string;
  headshotFileId?: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
  facebookUrl?: string | null;
  websiteUrl?: string | null;
};

async function patchProfile(eventId: string, payload: Payload): Promise<
  { ok: true; profile: SpeakerProfileDTO } | { ok: false; message: string; fieldErrors?: Record<string, string> }
> {
  let response: Response;
  try {
    response = await fetch(`/api/internal/portal/profile?eventId=${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, message: "That did not reach us — check your connection and try again" };
  }
  const body = await response.json().catch(() => null) as {
    data?: SpeakerProfileDTO;
    error?: { message?: string; data?: { fieldErrors?: Record<string, string> } };
  } | null;
  if (!response.ok || !body?.data) {
    const fieldErrors = body?.error?.data?.fieldErrors;
    return { ok: false, message: body?.error?.message ?? "That did not go through", ...(fieldErrors ? { fieldErrors } : {}) };
  }
  return { ok: true, profile: body.data };
}

/**
 * The speaker's own profile: bio, name, links, headshot. One explicit Save for
 * the text fields (not autosave, matching the reference product) plus an
 * independent headshot flow — a new photo lands as soon as it finishes
 * uploading, because making a speaker click Save twice to see their own new
 * photo would be a worse experience than the two writes being separate.
 *
 * Both paths go through `updateProfile`, which only ever sets the columns
 * present in its patch (resolution #13) — the headshot-only write here can
 * never revert bio/links a moment earlier, or vice versa.
 */
export function ProfileForm({ eventId, profile }: { eventId: string; profile: SpeakerProfileDTO }) {
  const router = useRouter();
  const { toast } = useToast();
  const [bioHtml, setBioHtml] = useState(profile.bioHtml ?? "");
  const [salutation, setSalutation] = useState(profile.salutation ?? "");
  const [honorific, setHonorific] = useState(profile.honorific ?? "");
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [pronouns, setPronouns] = useState(profile.pronouns ?? "");
  const [gender, setGender] = useState(profile.gender ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(profile.linkedinUrl ?? "");
  const [twitterUrl, setTwitterUrl] = useState(profile.twitterUrl ?? "");
  const [facebookUrl, setFacebookUrl] = useState(profile.facebookUrl ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(profile.websiteUrl ?? "");
  const [headshotFileId, setHeadshotFileId] = useState(profile.headshotFileId);
  const [headshotUrl, setHeadshotUrl] = useState(profile.headshotUrl);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // The exact function the server's .refine() rejects with — the counter and
  // the rejection can never disagree (R12).
  const bioLength = plainTextLength(bioHtml);
  const bioOverLimit = bioLength > LIMITS.BIO;

  async function save() {
    if (bioOverLimit) return;
    setSaving(true);
    setFieldErrors({});
    const result = await patchProfile(eventId, {
      bioHtml,
      salutation,
      honorific,
      firstName,
      lastName,
      pronouns,
      gender,
      linkedinUrl: nullIfBlank(linkedinUrl),
      twitterUrl: nullIfBlank(twitterUrl),
      facebookUrl: nullIfBlank(facebookUrl),
      websiteUrl: nullIfBlank(websiteUrl),
    });
    setSaving(false);
    if (!result.ok) {
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      toast(result.message);
      return;
    }
    toast("Saved successfully.");
    router.refresh();
  }

  async function onHeadshotUploaded(fileId: string) {
    const result = await patchProfile(eventId, { headshotFileId: fileId });
    if (!result.ok) {
      toast(result.message);
      return false;
    }
    setHeadshotFileId(result.profile.headshotFileId);
    setHeadshotUrl(result.profile.headshotUrl);
    toast("Photo updated.");
    router.refresh();
    return true;
  }

  const initials = `${firstName.trim().charAt(0)}${lastName.trim().charAt(0)}`.toUpperCase() || "?";

  return (
    <div className="portal-container portal-page">
      <header className="portal-page-header">
        <span className="public-eyebrow">YOUR PUBLIC PROFILE</span>
        <h1>Speaker profile</h1>
        <p>This information appears on the public speaker gallery.</p>
      </header>
      <div className="profile-edit-layout">
        <main>
          <section className="portal-panel profile-photo-section">
            <div className="profile-photo">
              {headshotUrl
                ? <Image src={headshotUrl} alt="" width={72} height={72} className="person-avatar person-avatar-xl" style={{ objectFit: "cover" }} unoptimized />
                : <Avatar initials={initials} size="xl" />}
              <span aria-hidden="true"><Camera size={16} /></span>
            </div>
            <div>
              <h2>Profile photo</h2>
              <p>A square image works best. JPG, PNG or WebP, up to 5 MB.</p>
              <FileUpload
                eventId={eventId}
                kind="headshot"
                currentFileId={headshotFileId}
                onUploaded={(fileId) => onHeadshotUploaded(fileId)}
                label="Upload new photo"
              />
            </div>
          </section>

          <section className="portal-panel profile-form">
            <h2>General</h2>
            <div className="form-grid">
              <Field label="Salutation"><input value={salutation} onChange={(event) => setSalutation(event.target.value)} placeholder="Dr., Ms., Mx…" /></Field>
              <Field label="Honorific"><input value={honorific} onChange={(event) => setHonorific(event.target.value)} placeholder="PhD, MBA…" /></Field>
              <Field label="First name" required><input value={firstName} onChange={(event) => setFirstName(event.target.value)} /></Field>
              <Field label="Last name"><input value={lastName} onChange={(event) => setLastName(event.target.value)} /></Field>
              <Field label="Pronouns">
                <input list="profile-pronoun-options" value={pronouns} onChange={(event) => setPronouns(event.target.value)} placeholder="she/her, he/him, they/them…" />
                <datalist id="profile-pronoun-options">
                  <option value="she/her" />
                  <option value="he/him" />
                  <option value="they/them" />
                </datalist>
              </Field>
              <Field label="Gender">
                <input list="profile-gender-options" value={gender} onChange={(event) => setGender(event.target.value)} placeholder="Optional" />
                <datalist id="profile-gender-options">
                  <option value="Woman" />
                  <option value="Man" />
                  <option value="Non-binary" />
                </datalist>
              </Field>
            </div>
            {fieldErrors.firstName && <p className="portal-note" role="alert">{fieldErrors.firstName}</p>}
            <Field label="Biography" hint={`${bioLength} / ${LIMITS.BIO} characters`}>
              <RichTextEditor
                value={bioHtml}
                onChange={setBioHtml}
                maxChars={LIMITS.BIO}
                placeholder="Tell attendees about yourself…"
              />
            </Field>
            {fieldErrors.bioHtml && <p className="portal-note" role="alert">{fieldErrors.bioHtml}</p>}

            <h2>My Links</h2>
            <div className="form-stack">
              <Field label="LinkedIn"><div className="input-icon"><Linkedin size={16} /><input value={linkedinUrl} onChange={(event) => setLinkedinUrl(event.target.value)} placeholder="https://linkedin.com/in/…" /></div></Field>
              <Field label="X (Twitter)"><div className="input-icon"><Twitter size={16} /><input value={twitterUrl} onChange={(event) => setTwitterUrl(event.target.value)} placeholder="https://x.com/…" /></div></Field>
              <Field label="Facebook"><div className="input-icon"><LinkIcon size={16} /><input value={facebookUrl} onChange={(event) => setFacebookUrl(event.target.value)} placeholder="https://facebook.com/…" /></div></Field>
              <Field label="Website"><div className="input-icon"><LinkIcon size={16} /><input value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://…" /></div></Field>
            </div>
            {(fieldErrors.linkedinUrl || fieldErrors.twitterUrl || fieldErrors.facebookUrl || fieldErrors.websiteUrl) && (
              <p className="portal-note" role="alert">Links need to start with http:// or https://</p>
            )}
            <footer>
              <Button onClick={() => void save()} disabled={saving || bioOverLimit}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </footer>
          </section>
        </main>
        <aside>
          <section className="portal-panel profile-readiness">
            <span className="metric-icon green"><CheckCircle2 size={20} /></span>
            <h3>Public preview</h3>
            <p>This is roughly how your profile appears on the public speaker gallery.</p>
          </section>
          <section className="portal-panel public-preview">
            <span>PUBLIC PREVIEW</span>
            {headshotUrl
              ? <Image src={headshotUrl} alt="" width={72} height={72} className="person-avatar person-avatar-xl" style={{ objectFit: "cover" }} unoptimized />
              : <Avatar initials={initials} size="xl" />}
            <h3>{firstName} {lastName}</h3>
            {pronouns && <p>{pronouns}</p>}
            <small>{bioLength > 0 ? `${plainTextPreview(bioHtml)}…` : "No biography yet."}</small>
          </section>
        </aside>
      </div>
    </div>
  );
}

function plainTextPreview(html: string): string {
  const text = html.replace(/<[^>]*>/g, "");
  return [...text].slice(0, 140).join("");
}
