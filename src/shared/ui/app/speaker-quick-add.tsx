"use client";

import { Plus, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Field } from "@/shared/ui/ui-kit";

export type QuickAddedSpeaker = { contactId: string; name: string };

/**
 * The create body, carrying only the fields the organizer actually filled in.
 *
 * `createSpeaker` is idempotent on email and patches whatever it is *given*, so
 * "add" against an address already on the event is an update. Sending
 * `firstName: ""` there would blank that contact's existing name and company —
 * quick-add has to be able to rediscover an existing speaker without destroying
 * their record.
 */
export function speakerCreateBody(fields: {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
}): Record<string, string> {
  return {
    email: fields.email.trim(),
    ...(fields.firstName.trim() ? { firstName: fields.firstName.trim() } : {}),
    ...(fields.lastName.trim() ? { lastName: fields.lastName.trim() } : {}),
    ...(fields.company.trim() ? { company: fields.company.trim() } : {}),
  };
}

type SpeakerCreatedResponse = {
  data?: { contact?: { contactId?: string; name?: string; email?: string } };
  error?: { message?: string };
};

/**
 * Create a speaker without leaving the surface you are already on.
 *
 * The invited keynote is usually the *first* thing an organizer does on a new
 * event, when the contact list is still empty — so the two surfaces that attach
 * a person to a talk (the agenda's session dialog, the Add abstract drawer)
 * both used to dead-end there: the picker said "no contacts yet" and offered
 * nothing to do about it, and the only way forward was to abandon a half-filled
 * form, go to Speakers, and start over (#117).
 *
 * It expands in place rather than opening a dialog. Both callers already sit
 * inside a native `<dialog>`, and a second modal on top of the first would take
 * the focus trap with it and put the organizer's half-typed session behind two
 * layers of chrome.
 *
 * Email is the only required field, because it is the only one the contact
 * record needs and the only one the organizer reliably has when the agreement
 * arrived by mail. Everything else is editable later on the speaker's page.
 */
export function SpeakerQuickAdd({
  eventId,
  onAdded,
  onPendingChange,
  disabled = false,
}: {
  eventId: string;
  /** Called with the created contact so the caller can select it immediately. */
  onAdded: (speaker: QuickAddedSpeaker) => void;
  /** Lets a containing mutation wait until the selected contact really exists. */
  onPendingChange?: (pending: boolean) => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const pendingChangeRef = useRef(onPendingChange);

  useEffect(() => {
    pendingChangeRef.current = onPendingChange;
  }, [onPendingChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // A containing dialog can be replaced externally even though its own
      // close action is blocked. Never strand that replacement in a busy state.
      pendingChangeRef.current?.(false);
    };
  }, []);

  function collapse() {
    setExpanded(false);
    setEmail(""); setFirstName(""); setLastName(""); setCompany("");
    setError(null);
  }

  async function submit() {
    if (saving || disabled) return;
    setSaving(true);
    pendingChangeRef.current?.(true);
    setError(null);
    try {
      const response = await fetch(`/api/internal/speakers/${eventId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(speakerCreateBody({ email, firstName, lastName, company })),
      });
      const json = await response.json().catch(() => null) as SpeakerCreatedResponse | null;
      const contact = json?.data?.contact;
      if (!mountedRef.current) return;
      if (!response.ok || !contact?.contactId) {
        setError(json?.error?.message ?? "Could not add that speaker");
        return;
      }
      onAdded({ contactId: contact.contactId, name: contact.name?.trim() || contact.email || email });
      collapse();
    } catch {
      if (mountedRef.current) setError("Could not add that speaker — check your connection and try again");
    } finally {
      if (mountedRef.current) {
        setSaving(false);
        pendingChangeRef.current?.(false);
      }
    }
  }

  if (!expanded) {
    return (
      <Button variant="secondary" size="sm" disabled={disabled} onClick={() => setExpanded(true)}>
        <UserPlus size={14} /> Add a speaker
      </Button>
    );
  }

  return (
    <div className="speaker-quick-add">
      {error && <p className="portal-note" role="alert">{error}</p>}
      <Field label="Email" required>
        <input
          type="email"
          required
          value={email}
          disabled={saving}
          onChange={(event) => { setEmail(event.target.value); setError(null); }}
          placeholder="speaker@example.com"
        />
      </Field>
      <div className="form-grid">
        <Field label="First name">
          <input value={firstName} disabled={saving} onChange={(event) => setFirstName(event.target.value)} />
        </Field>
        <Field label="Last name">
          <input value={lastName} disabled={saving} onChange={(event) => setLastName(event.target.value)} />
        </Field>
      </div>
      <Field label="Company">
        <input value={company} disabled={saving} onChange={(event) => setCompany(event.target.value)} />
      </Field>
      <div className="speaker-quick-add-actions">
        <Button variant="secondary" size="sm" disabled={saving} onClick={collapse}>Cancel</Button>
        <Button size="sm" disabled={saving || email.trim() === ""} onClick={() => void submit()}>
          {saving ? "Adding…" : <><Plus size={14} /> Add speaker</>}
        </Button>
      </div>
    </div>
  );
}
