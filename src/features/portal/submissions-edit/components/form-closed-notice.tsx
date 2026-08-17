import { ArrowLeft } from "lucide-react";
import Link from "next/link";

/**
 * The friendly page a speaker sees when the form closed between opening their
 * submission and opening the edit page — the same "apology, not a dead end"
 * framing M14 built for the public CFP path (`PublicFormGate`), reused here
 * rather than a second copy of the copy.
 */
export function FormClosedNotice({ detailHref }: { detailHref: string }) {
  return (
    <article className="portal-submission-edit">
      <Link className="portal-back" href={detailHref}><ArrowLeft size={14} /> Back to submission</Link>
      <div className="portal-panel portal-panel--padded">
        <h1>Submissions are closed</h1>
        <p className="portal-note">
          This call for speakers is no longer accepting new or updated submissions, so this submission can&rsquo;t be
          edited here anymore. Your last saved answers are still on file — reach out to the organizers if something
          needs to change.
        </p>
      </div>
    </article>
  );
}
