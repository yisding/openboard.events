import Link from "next/link";
import { ArrowRight, CalendarDays, CheckCircle2, Sparkles } from "lucide-react";
import { Brand } from "@/shared/ui/brand";
import { getEnv, isCredentialFreeLocalDemo } from "@/shared/lib/env";

// `seedId("form", "form-a")` — scripts/seed/lib/ids.ts derives every seeded
// row's id from a SHA-1 (uuidv5) of a fixed namespace plus this literal key,
// so it is the same id on every seed run against every database. It is the
// AI.Engineer Sandbox event's open CFP form (`scripts/seed/forms.ts`).
const SEEDED_CFP_FORM_ID = "f00d8460-e8d9-58de-ab01-f37d4ffe53df";

export default function HomePage() {
  // Evaluated per render rather than at module scope: `isCredentialFreeLocalDemo`
  // reads the current request's Cloudflare env binding, which only exists
  // inside a request's execution context (see `portal/[eventSlug]/layout.tsx`
  // for the same call site pattern).
  //
  // The credential-free local demo runs against in-memory mock data keyed by
  // human-readable slugs that don't exist in a real database. Every other
  // target (preview, production, or a local run wired to Postgres) needs
  // URLs that resolve against the seeded world instead.
  const demoMode = isCredentialFreeLocalDemo();
  const signupEnabled = getEnv().ADMIN_AUTH_PROVIDER === "better-auth";
  const cfpHref = demoMode ? "/submit/ai-engineer/technical-talks" : `/submit/ai-engineer-sandbox-event/${SEEDED_CFP_FORM_ID}`;
  // The M53 canonical public agenda surface.
  const agendaHref = demoMode ? "/e/ai-engineer/schedule" : "/e/ai-engineer-sandbox-event/agenda";

  return (
    <main className="landing">
      <nav className="landing-nav container">
        <Brand dark />
        <div className="landing-links">
          <a href="#features">Platform</a>
          <a href="#story">Why Openboard</a>
          <Link href={cfpHref}>View sample CFP</Link>
          <Link className="button button-secondary" href="/login">Sign in</Link>
          <Link className="button button-primary" href={signupEnabled ? "/signup" : "/events"}>
            {signupEnabled ? "Create workspace" : "Open demo"} <ArrowRight size={16} />
          </Link>
        </div>
      </nav>

      <section className="hero container">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={14} /> Built for ambitious event teams</div>
          <h1>Every speaker. Every session. <span>One calm command center.</span></h1>
          <p>Openboard brings submissions, speaker onboarding, communications, and scheduling into one beautifully focused workspace.</p>
          <div className="hero-actions">
            <Link className="button button-primary button-lg" href={signupEnabled ? "/signup" : "/events"}>
              {signupEnabled ? "Create your workspace" : "Explore the live demo"} <ArrowRight size={18} />
            </Link>
            <Link className="button button-secondary button-lg" href={cfpHref}>View a sample CFP</Link>
            <Link className="button button-ghost button-lg" href={agendaHref}>See the public agenda</Link>
          </div>
          <div className="hero-proof"><CheckCircle2 size={17} /> Go from signup to a live CFP in one guided setup</div>
        </div>
        <div className="hero-art" aria-label="Openboard dashboard preview">
          <div className="hero-glow" />
          <div className="preview-window">
            <div className="preview-chrome"><i /><i /><i /><span>AI Engineer World&apos;s Fair</span></div>
            <div className="preview-body">
              <aside><Brand compact /><div className="preview-nav-lines">{Array.from({ length: 7 }, (_, i) => <b key={i} />)}</div></aside>
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
