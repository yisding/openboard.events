import React from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { PublicForm } from "@/features/forms";
import { formatInZone } from "@/shared/lib/time";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import styles from "./public-form-gate.module.css";

function EventBackground({ url, children }: { url: string | null; children: React.ReactNode }) {
  // Keep the unbranded path markup- and layout-compatible with existing CFPs.
  if (!url) return <>{children}</>;

  return (
    <div className={styles.frame}>
      {/* Event files are served from the same-origin immutable /f/ route. An
          empty alt keeps this visual branding out of the accessibility tree. */}
      <Image
        src={url}
        alt=""
        aria-hidden="true"
        className={styles.background}
        fill
        unoptimized
        sizes="(max-width: 800px) calc(100vw - 40px), 760px"
      />
      <div className={styles.content}>{children}</div>
    </div>
  );
}

function EventIdentity({ event }: { event: PublicForm["event"] }) {
  const eventHref = `/e/${encodeURIComponent(event.slug)}/agenda`;
  return (
    <div className={styles.eventBar}>
      <Link className={styles.eventIdentity} href={eventHref} aria-label={`${event.name} event site`}>
        {event.logoUrl
          ? <Image src={event.logoUrl} alt="" aria-hidden="true" className={styles.eventLogo} width={80} height={40} />
          : <span className={styles.eventFallback} aria-hidden="true">{event.name.trim().charAt(0).toUpperCase()}</span>}
        <span><small>Call for speakers</small><b>{event.name}</b></span>
      </Link>
      <Link className={styles.backLink} href={eventHref}><ArrowLeft size={15} /> Event site</Link>
    </div>
  );
}

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
      <EventBackground url={event.backgroundUrl}>
        <EventIdentity event={event} />
        <section className="cfp-closed">
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
          <Link href={`/e/${event.slug}/agenda`}>See the program</Link>
        </section>
      </EventBackground>
    );
  }

  return (
    <EventBackground url={event.backgroundUrl}>
      <EventIdentity event={event} />
      <header className="public-form-welcome">
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
    </EventBackground>
  );
}
