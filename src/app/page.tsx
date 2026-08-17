import Link from "next/link";
import { ArrowRight, CalendarDays, CheckCircle2, Sparkles } from "lucide-react";
import { getAdminSession } from "@/features/auth";
import { Brand } from "@/shared/ui/brand";
import { LandingMobileNav } from "./landing-mobile-nav";

// Session state is request-specific; do not freeze it into a prerender.
export const dynamic = "force-dynamic";

// `seedId("form", "form-a")` — scripts/seed/lib/ids.ts derives every seeded
// row's id from a SHA-1 (uuidv5) of a fixed namespace plus this literal key,
// so it is the same id on every seed run against every database. It is the
// AI.Engineer Sandbox event's open CFP form (`scripts/seed/forms.ts`).
const SEEDED_CFP_FORM_ID = "f00d8460-e8d9-58de-ab01-f37d4ffe53df";

// The landing CTAs point at the seeded AI.Engineer Sandbox event, which every
// target — preview, production, or a local run — gets from `pnpm seed`.
const CFP_HREF = `/submit/ai-engineer-sandbox-event/${SEEDED_CFP_FORM_ID}`;
// The M53 canonical public agenda surface.
const AGENDA_HREF = "/e/ai-engineer-sandbox-event/agenda";

export default async function HomePage() {
  const signedIn = Boolean(await getAdminSession());
  const workspaceHref = signedIn ? "/organizations" : "/signup";
  const workspaceNavLabel = signedIn ? "Open workspace" : "Create workspace";
  const workspaceHeroLabel = signedIn ? "Open your workspace" : "Create your workspace";
  const workspaceProof = signedIn
    ? "Continue your event setup or pick up where your team left off"
    : "Go from signup to a live call for speakers in one guided setup";
  return (
    <main className="landing">
      <nav className="landing-nav container">
        <Brand dark />
        <div className="landing-links">
          <a href="#features">Platform</a>
          <a href="#story">Why Openboard</a>
          <Link href={CFP_HREF}>Sample call for speakers</Link>
          <LandingMobileNav cfpHref={CFP_HREF} showSignIn={!signedIn} />
          {!signedIn && <Link className="button button-secondary" href="/login">Sign in</Link>}
          <Link className="button button-primary" href={workspaceHref}>{workspaceNavLabel} <ArrowRight size={16} /></Link>
        </div>
      </nav>

      <section className="hero container">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={14} /> Built for ambitious event teams</div>
          <h1>Every speaker. Every session. <span>One calm command center.</span></h1>
          <p>Openboard brings submissions, speaker onboarding, communications, and scheduling into one beautifully focused workspace.</p>
          <div className="hero-actions">
            <Link className="button button-primary button-lg" href={workspaceHref}>{workspaceHeroLabel} <ArrowRight size={18} /></Link>
            <Link className="button button-secondary button-lg" href={CFP_HREF}>View a sample call for speakers</Link>
            <Link className="button button-ghost button-lg" href={AGENDA_HREF}>See the public agenda</Link>
          </div>
          <div className="hero-proof"><CheckCircle2 size={17} /> {workspaceProof}</div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-glow" />
          <div className="preview-window">
            <div className="preview-chrome"><i /><i /><i /><span>AI Engineer World’s Fair</span></div>
            <div className="preview-body">
              <aside><Brand compact decorative /><div className="preview-nav-lines">{Array.from({ length: 7 }, (_, i) => <b key={i} />)}</div></aside>
              <div className="preview-main">
                <div className="preview-heading"><span>Good morning, Maya</span><span className="preview-add">＋ Add</span></div>
                <div className="preview-stats"><article><small>Submissions</small><strong>247</strong><em>↑ 18%</em></article><article><small>Accepted</small><strong>82</strong><em>33%</em></article><article><small>Tasks done</small><strong>91%</strong><em>On track</em></article></div>
                <div className="preview-chart"><div className="chart-bars">{[30, 48, 42, 72, 58, 86, 70, 96, 78, 100, 90].map((n, i) => <i key={i} style={{ height: `${n}%` }} />)}</div></div>
                <div className="preview-list">{["Nadia Rahman", "Alex Chen", "Priya Shah"].map((name, i) => <div key={name}><span className={`avatar avatar-${i + 1}`}>{name.split(" ").map((v) => v[0]).join("")}</span><b>{name}</b><small>{i === 0 ? "2 tasks remaining" : "Ready"}</small></div>)}</div>
              </div>
            </div>
          </div>
          <div className="floating-card floating-card-one"><span className="floating-icon"><CalendarDays size={20} /></span><div><b>Schedule published</b><small>32 sessions are live</small></div></div>
          <div className="floating-card floating-card-two"><span className="pulse-dot" /><div><b>Live sync</b><small>Everything is up to date</small></div></div>
        </div>
      </section>

      <section id="features" className="landing-strip landing-section">
        <div className="container">
          <div className="landing-section-head">
            <div className="eyebrow">Platform</div>
            <h2>One workspace for the whole event team</h2>
          </div>
          <div className="landing-feature-grid">
            <article>
              <h3>CFP & Reviews</h3>
              <p>Collect proposals and route them to reviewers so every accept or decline comes from one shared queue.</p>
            </article>
            <article>
              <h3>Speaker Success</h3>
              <p>Accepted speakers get a task list and deadline reminders, so nothing is missing when the schedule locks.</p>
            </article>
            <article>
              <h3>Agenda Planning</h3>
              <p>Place sessions on a real time grid and catch room and speaker conflicts before they reach the program.</p>
            </article>
            <article>
              <h3>Communications</h3>
              <p>Send decisions and updates from templates, with a full delivery history for every message.</p>
            </article>
          </div>
        </div>
      </section>

      <section id="story" className="landing-strip landing-section">
        <div className="container">
          <div className="landing-section-head">
            <div className="eyebrow">Why Openboard</div>
            <h2>Built to replace the spreadsheet-and-inbox event stack</h2>
          </div>
          <div className="landing-feature-grid">
            <article>
              <h3>One source of truth</h3>
              <p>Submissions, speakers, and the schedule live in one place instead of five spreadsheets and a shared inbox.</p>
            </article>
            <article>
              <h3>No dropped speakers</h3>
              <p>Task tracking and automatic reminders mean a missed deadline shows up before it becomes a surprise.</p>
            </article>
            <article>
              <h3>Hours back every week</h3>
              <p>Bulk actions and templated messages replace the manual, one-by-one busywork around every deadline.</p>
            </article>
            <article>
              <h3>A calm event day</h3>
              <p>Schedule status and conflicts are all visible in one dashboard on the day it actually matters.</p>
            </article>
          </div>
        </div>
      </section>
    </main>
  );
}
