import { Brand } from "@/shared/ui/brand";

export function AuthBrandPanel() {
  return <aside className="login-brand-panel" aria-label="About Openboard">
    <Brand />
    <div>
      <span>THE EVENT OS FOR AMBITIOUS TEAMS</span>
      <p className="login-brand-heading">Build programs people remember.</p>
      <p>Submissions, speakers, schedules, and every detail in between.</p>
    </div>
    <small>© 2026 Openboard</small>
  </aside>;
}
