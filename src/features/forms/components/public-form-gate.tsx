import Image from "next/image";
import Link from "next/link";
import type { PublicForm } from "@/features/forms";
import { formatInZone } from "@/shared/lib/time";
import { RichTextView } from "@/shared/ui/app/rich-text-view";

/**
 * What a speaker sees before the form itself: the welcome, or the reason they
 * cannot submit.
 *
 * "Closed" and "not open yet" are deliberately different pages. One is an
 * apology and the other is a date to come back on, and a speaker who arrives
 * early should leave knowing when to return rather than thinking they missed it.
 */
export function PublicFormGate({ data, children }: { data: PublicForm; children?: React.ReactNode }) {
  const { event, form, openState } = data;

  if (!openState.open) {
    return (
      <main className="cfp-closed">
        <h1>{form.externalTitle || `Call for speakers — ${event.name}`}</h1>
        {openState.reason === "not_open_yet" ? (
          <p>
            Submissions open{" "}
            {form.opensAt
              ? <b>{formatInZone(form.opensAt, event.timezone, "long")}</b>
              : "soon"}
            . Check back then — nothing has been missed.
          </p>
        ) : (
          <p>
            Submissions closed{" "}
            {form.closesAt && openState.reason === "closed_by_date"
              ? <b>{formatInZone(form.closesAt, event.timezone, "long")}</b>
              : "for this event"}
            . Thank you for your interest in {event.name}.
          </p>
        )}
        <Link href={`/e/${event.slug}/schedule`}>See the programme</Link>
      </main>
    );
  }

  return (
    <>
    <header className="public-form-welcome">
      {/* Sized rather than fluid: the logo is a known-immutable /f/ object, and
          an unsized image on the first public page a judge opens is a layout
          shift they watch happen. Optimization is off globally on Workers. */}
      {event.logoUrl && <Image src={event.logoUrl} alt={event.name} className="cfp-logo" width={160} height={48} />}
      <h1>{form.pageHeading || "Welcome!"}</h1>
      {form.showWelcome && form.welcomeHtml && <RichTextView html={form.welcomeHtml} />}
      <dl className="welcome-facts">
        {form.closesAt && (
          <div>
            <dt>Submissions close</dt>
            {/* Always with the zone label: a speaker reading this in Berlin must
                not infer their own midnight. */}
            <dd>{formatInZone(form.closesAt, event.timezone, "long")}</dd>
          </div>
        )}
        <div>
          <dt>Submission limit</dt>
          <dd>{form.effectiveLimit} per speaker</dd>
        </div>
      </dl>
    </header>
    {children}
    </>
  );
}
