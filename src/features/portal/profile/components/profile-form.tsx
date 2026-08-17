"use client";

import { Camera, Linkedin, LinkIcon, Twitter } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SpeakerProfileDTO } from "@/features/portal";
import { LIMITS, plainTextLength } from "@/shared/contracts";
import { readFieldErrors } from "@/shared/lib/api-client";
import { FileUpload } from "@/shared/ui/app/file-upload";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { useToast } from "@/shared/ui/toast";
import { Avatar, Button, Field } from "@/shared/ui/ui-kit";
import { textDraftChanged } from "../profile-text-draft";

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
  jobTitle?: string;
  company?: string;
  headshotFileId?: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
  facebookUrl?: string | null;
  websiteUrl?: string | null;
};

export type ProfileTextDraft = {
  bioHtml: string;
  salutation: string;
  honorific: string;
  firstName: string;
  lastName: string;
  pronouns: string;
  gender: string;
  jobTitle: string;
  company: string;
  linkedinUrl: string;
  twitterUrl: string;
  facebookUrl: string;
  websiteUrl: string;
};

export function profileTextDraft(profile: SpeakerProfileDTO): ProfileTextDraft {
  return {
    bioHtml: profile.bioHtml ?? "",
    salutation: profile.salutation ?? "",
    honorific: profile.honorific ?? "",
    firstName: profile.firstName,
    lastName: profile.lastName,
    pronouns: profile.pronouns ?? "",
    gender: profile.gender ?? "",
    jobTitle: profile.jobTitle ?? "",
    company: profile.company ?? "",
    linkedinUrl: profile.linkedinUrl ?? "",
    twitterUrl: profile.twitterUrl ?? "",
    facebookUrl: profile.facebookUrl ?? "",
    websiteUrl: profile.websiteUrl ?? "",
  };
}

export function profileTextChanged(draft: ProfileTextDraft, baseline: ProfileTextDraft): boolean {
  return textDraftChanged(draft, baseline);
}

/** Exported for test: the envelope shape this reads is the whole defect it fixes. */
export async function patchProfile(eventId: string, payload: Payload): Promise<
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
    error?: { message?: string; fieldErrors?: Record<string, string>; data?: unknown };
  } | null;
  if (!response.ok || !body?.data) {
    // `readFieldErrors`, not `error.data.fieldErrors`. `errorEnvelope` puts a
    // zod failure's `fieldErrors` at the *top level* of `error`, and `data` is
    // `AppError.details` — a different constructor argument entirely. The
    // headshot validations pass their map as `fieldErrors` with no `details`,
    // so `error.data.fieldErrors` was always absent: `setFieldErrors` only ever
    // received nothing, and all eight `error={fieldErrors.*}` slots plus the
    // focus-first-invalid effect were dead code. A speaker whose company or job
    // title exceeds its limit got a bare "Request validation failed" toast with
    // no field highlighted and no focus moved, across twelve inputs. The CFP
    // client reads both shapes; this one read only the wrong one.
    const fieldErrors = readFieldErrors(body?.error);
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
  const initialText = profileTextDraft(profile);
  const [bioHtml, setBioHtml] = useState(initialText.bioHtml);
  const [salutation, setSalutation] = useState(initialText.salutation);
  const [honorific, setHonorific] = useState(initialText.honorific);
  const [firstName, setFirstName] = useState(initialText.firstName);
  const [lastName, setLastName] = useState(initialText.lastName);
  const [pronouns, setPronouns] = useState(initialText.pronouns);
  const [gender, setGender] = useState(initialText.gender);
  const [jobTitle, setJobTitle] = useState(initialText.jobTitle);
  const [company, setCompany] = useState(initialText.company);
  const [linkedinUrl, setLinkedinUrl] = useState(initialText.linkedinUrl);
  const [twitterUrl, setTwitterUrl] = useState(initialText.twitterUrl);
  const [facebookUrl, setFacebookUrl] = useState(initialText.facebookUrl);
  const [websiteUrl, setWebsiteUrl] = useState(initialText.websiteUrl);
  const [savedText, setSavedText] = useState(initialText);
  const [headshotFileId, setHeadshotFileId] = useState(profile.headshotFileId);
  const [headshotUrl, setHeadshotUrl] = useState(profile.headshotUrl);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const currentText: ProfileTextDraft = {
    bioHtml, salutation, honorific, firstName, lastName, pronouns, gender, jobTitle, company,
    linkedinUrl, twitterUrl, facebookUrl, websiteUrl,
  };
  const dirty = profileTextChanged(currentText, savedText);
  useUnsavedWorkGuard(dirty);

  // The exact function the server's .refine() rejects with — the counter and
  // the rejection can never disagree (R12).
  const bioLength = plainTextLength(bioHtml);
  const bioOverLimit = bioLength > LIMITS.BIO;
  const bioError = fieldErrors.bioHtml ?? (bioOverLimit ? `Keep this under ${LIMITS.BIO} characters` : undefined);

  useEffect(() => {
    if (Object.keys(fieldErrors).length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [fieldErrors]);

  async function save() {
    if (bioOverLimit) return;
    const submittedText = currentText;
    setSaving(true);
    setFieldErrors({});
    const result = await patchProfile(eventId, {
      bioHtml: submittedText.bioHtml,
      salutation: submittedText.salutation,
      honorific: submittedText.honorific,
      firstName: submittedText.firstName,
      lastName: submittedText.lastName,
      pronouns: submittedText.pronouns,
      gender: submittedText.gender,
      jobTitle: submittedText.jobTitle,
      company: submittedText.company,
      linkedinUrl: nullIfBlank(submittedText.linkedinUrl),
      twitterUrl: nullIfBlank(submittedText.twitterUrl),
      facebookUrl: nullIfBlank(submittedText.facebookUrl),
      websiteUrl: nullIfBlank(submittedText.websiteUrl),
    });
    setSaving(false);
    if (!result.ok) {
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      toast(result.message, { kind: "error" });
      return;
    }
    setSavedText(submittedText);
    toast("Saved successfully.");
    router.refresh();
  }

  async function onHeadshotUploaded(fileId: string) {
    const result = await patchProfile(eventId, { headshotFileId: fileId });
    if (!result.ok) {
      toast(result.message, { kind: "error" });
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
              <Avatar initials={initials} size="xl" {...(headshotUrl ? { imageUrl: headshotUrl } : {})} />
              <span className="profile-photo-badge" aria-hidden="true"><Camera size={16} /></span>
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

          <form ref={formRef} className="portal-panel profile-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <h2>General</h2>
            <div className="form-grid">
              <Field label="Salutation"><input value={salutation} onChange={(event) => setSalutation(event.target.value)} placeholder="Dr., Ms., Mx…" /></Field>
              <Field label="Honorific"><input value={honorific} onChange={(event) => setHonorific(event.target.value)} placeholder="PhD, MBA…" /></Field>
              <Field label="First name" required error={fieldErrors.firstName} errorId="profile-first-name-error">
                <input required aria-invalid={Boolean(fieldErrors.firstName) || undefined} aria-describedby={fieldErrors.firstName ? "profile-first-name-error" : undefined} value={firstName} onChange={(event) => setFirstName(event.target.value)} />
              </Field>
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
              <Field label="Job title" hint="Shown under your name on the public site" hintId="profile-job-title-hint" error={fieldErrors.jobTitle} errorId="profile-job-title-error">
                <input maxLength={LIMITS.JOB_TITLE} value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} aria-invalid={Boolean(fieldErrors.jobTitle) || undefined} aria-describedby={fieldErrors.jobTitle ? "profile-job-title-error" : "profile-job-title-hint"} placeholder="Principal Engineer" />
              </Field>
              <Field label="Company" hint="Shown under your name on the public site" hintId="profile-company-hint" error={fieldErrors.company} errorId="profile-company-error">
                <input maxLength={LIMITS.JOB_TITLE} value={company} onChange={(event) => setCompany(event.target.value)} aria-invalid={Boolean(fieldErrors.company) || undefined} aria-describedby={fieldErrors.company ? "profile-company-error" : "profile-company-hint"} placeholder="Analytical Engines" />
              </Field>
            </div>
            {/* No `hint`: RichTextEditor already renders its own "used / max"
                counter (with `aria-live="polite"`), so a character-count hint
                here would just repeat it right below — the field only adds an
                error message when the bio is over the limit. */}
            <Field label="Biography" error={bioError} errorId="profile-bio-error">
              <RichTextEditor
                value={bioHtml}
                onChange={setBioHtml}
                maxChars={LIMITS.BIO}
                placeholder="Tell attendees about yourself…"
                ariaLabel="Biography"
                ariaInvalid={Boolean(bioError)}
                {...(bioError ? { ariaDescribedBy: "profile-bio-error" } : {})}
              />
            </Field>

            <h2>My Links</h2>
            <div className="form-stack">
              <Field label="LinkedIn" error={fieldErrors.linkedinUrl} errorId="profile-linkedin-error"><div className="input-icon"><Linkedin size={16} /><input type="url" aria-invalid={Boolean(fieldErrors.linkedinUrl) || undefined} aria-describedby={fieldErrors.linkedinUrl ? "profile-linkedin-error" : undefined} value={linkedinUrl} onChange={(event) => setLinkedinUrl(event.target.value)} placeholder="https://linkedin.com/in/…" /></div></Field>
              <Field label="X (Twitter)" error={fieldErrors.twitterUrl} errorId="profile-twitter-error"><div className="input-icon"><Twitter size={16} /><input type="url" aria-invalid={Boolean(fieldErrors.twitterUrl) || undefined} aria-describedby={fieldErrors.twitterUrl ? "profile-twitter-error" : undefined} value={twitterUrl} onChange={(event) => setTwitterUrl(event.target.value)} placeholder="https://x.com/…" /></div></Field>
              <Field label="Facebook" error={fieldErrors.facebookUrl} errorId="profile-facebook-error"><div className="input-icon"><LinkIcon size={16} /><input type="url" aria-invalid={Boolean(fieldErrors.facebookUrl) || undefined} aria-describedby={fieldErrors.facebookUrl ? "profile-facebook-error" : undefined} value={facebookUrl} onChange={(event) => setFacebookUrl(event.target.value)} placeholder="https://facebook.com/…" /></div></Field>
              <Field label="Website" error={fieldErrors.websiteUrl} errorId="profile-website-error"><div className="input-icon"><LinkIcon size={16} /><input type="url" aria-invalid={Boolean(fieldErrors.websiteUrl) || undefined} aria-describedby={fieldErrors.websiteUrl ? "profile-website-error" : undefined} value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://…" /></div></Field>
            </div>
            <footer>
              <Button type="submit" disabled={saving || bioOverLimit}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </footer>
          </form>
        </main>
        <aside>
          <section className="portal-panel public-preview">
            <span className="public-preview-label">PUBLIC PREVIEW</span>
            <p className="public-preview-hint">This is roughly how your profile appears on the public speaker gallery.</p>
            <Avatar initials={initials} size="xl" {...(headshotUrl ? { imageUrl: headshotUrl } : {})} />
            <h3>{firstName} {lastName}</h3>
            {(jobTitle || company) && <p>{[jobTitle, company].filter(Boolean).join(" · ")}</p>}
            {pronouns && <p>{pronouns}</p>}
            {/* The ellipsis belongs to the truncation, not to the preview: an
                unabridged bio was being shown as though there were more of it,
                live, while the speaker typed. */}
            <small>{bioLength > 0 ? plainTextPreview(bioHtml) : "No biography yet."}</small>
          </section>
        </aside>
      </div>
    </div>
  );
}

/**
 * The ellipsis is part of the truncation, so it is decided here rather than by
 * the caller: appending it unconditionally told a speaker with a short bio that
 * the card was hiding the rest of it, and did so live as they typed.
 * Code points, not UTF-16 units, so a slice never lands mid-emoji.
 */
function plainTextPreview(html: string): string {
  // Strip to a fixpoint so nested fragments like `<scr<script>ipt>` cannot
  // reassemble a tag. A regex loop rather than DOMParser: this render path
  // also runs during SSR, where DOMParser does not exist, and the output must
  // be identical on both sides to hydrate cleanly.
  let text = html;
  let before: string;
  do {
    before = text;
    text = text.replace(/<[^>]*>/g, "");
  } while (text !== before);
  const characters = [...text];
  return characters.length > 140 ? `${characters.slice(0, 140).join("")}…` : text;
}
