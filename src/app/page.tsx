import Link from "next/link";
import { ArrowRight, CalendarDays, CheckCircle2, Sparkles } from "lucide-react";
import { Brand } from "@/shared/ui/brand";

export default function HomePage() {
  return (
    <main className="landing">
      <nav className="landing-nav container">
        <Brand dark />
        <div className="landing-links">
          <a href="#features">Platform</a>
          <a href="#story">Why Openboard</a>
          <Link className="button button-secondary" href="/submit/ai-engineer/technical-talks">View CFP</Link>
          <Link className="button button-primary" href="/events">Open demo <ArrowRight size={16} /></Link>
        </div>
      </nav>

      <section className="hero container">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={14} /> Built for ambitious event teams</div>
          <h1>Every speaker. Every session. <span>One calm command center.</span></h1>
          <p>Openboard brings submissions, speaker onboarding, communications, and scheduling into one beautifully focused workspace.</p>
          <div className="hero-actions">
            <Link className="button button-primary button-lg" href="/events">Explore the live demo <ArrowRight size={18} /></Link>
            <Link className="button button-ghost button-lg" href="/e/ai-engineer/schedule">See the public agenda</Link>
          </div>
          <div className="hero-proof"><CheckCircle2 size={17} /> Seeded with a complete AI Engineer event</div>
        </div>
        <div className="hero-art" aria-label="Openboard dashboard preview">
          <div className="hero-glow" />
          <div className="preview-window">
            <div className="preview-chrome"><i /><i /><i /><span>AI Engineer World&apos;s Fair</span></div>
            <div className="preview-body">
              <aside><Brand compact /><div className="preview-nav-lines">{Array.from({ length: 7 }, (_, i) => <b key={i} />)}</div></aside>
              <div className="preview-main">
                <div className="preview-heading"><span>Good morning, Maya</span><button>＋ Add</button></div>
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

      <section id="features" className="landing-strip">
        <div className="container logo-strip"><span>One workspace for</span><b>CFP & Reviews</b><b>Speaker Success</b><b>Agenda Planning</b><b>Communications</b></div>
      </section>

      <section id="story" className="landing-strip">
        <div className="container logo-strip"><span>Why Openboard</span><b>One source of truth</b><b>No dropped speakers</b><b>Hours back every week</b><b>A calm event day</b></div>
      </section>
    </main>
  );
}
