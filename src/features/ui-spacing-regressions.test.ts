import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("shared UI spacing regressions", () => {
  const css = read("../app/globals.css");

  it("top-aligns paired fields so one field's error cannot move its neighbor", () => {
    expect(css).toMatch(/\.form-grid\s*\{[^}]*align-items:\s*start/gu);
    expect(css).toMatch(/\.field\s*\{[^}]*align-content:\s*start/gu);
    expect(css).toMatch(/\.datetime-picker\{[^}]*height:40px/gu);
  });

  it("uses the application theme for the complete calendar surface", () => {
    const picker = read("../shared/ui/app/datetime-picker.tsx");
    const formRenderer = read("./forms/components/form-field-renderer.tsx");

    expect(picker).toContain('role="dialog"');
    expect(picker).toContain('className="datetime-calendar-grid"');
    expect(picker).toContain("CalendarDatePicker");
    expect(formRenderer).toContain("<CalendarDatePicker");
    expect(css).toContain(".datetime-popover{position:fixed;z-index:300;");
    expect(css).toContain("background:var(--surface);box-shadow:var(--shadow);");
    expect(css).toContain(".datetime-calendar-day.is-selected{border-color:var(--accent);background:var(--accent);color:var(--on-accent);");
    expect(css).toContain(".datetime-picker-warning{");
  });

  it("gives evaluation drawers the shared body inset and a compact invite variant", () => {
    const invite = read("./submissions/evaluation/components/reviewer-invite-dialog.tsx");
    const plan = read("./submissions/evaluation/components/plan-editor.tsx");
    const assignment = read("./submissions/evaluation/components/assignment-drawer.tsx");

    expect(invite).toContain("<Drawer open compact");
    expect(invite).toContain('className="drawer-body drawer-form"');
    expect(plan).toContain('className="form-stack drawer-body"');
    expect(plan).toContain('className="evaluation-field-row evaluation-number-row"');
    expect(plan).toContain('className="evaluation-field-row evaluation-window-row"');
    expect(plan).toContain('className="evaluation-field-row evaluation-criterion-row"');
    expect(assignment).toContain('className="form-stack drawer-body"');
    expect(css).toContain(".drawer-body { padding: 24px; }");
    expect(css).toContain(".drawer-compact { width: min(480px, 95vw); }");
    expect(css).toContain(".evaluation-number-row{grid-template-columns:repeat(3,minmax(0,1fr))}");
    expect(css).toContain(".reviewer-pending-invitations li{display:flex;align-items:center;justify-content:space-between;gap:12px");
  });

  it("keeps repeated action clusters visibly separated", () => {
    const plans = read("./submissions/evaluation/components/plans-view.tsx");
    const assignment = read("./submissions/evaluation/components/assignment-drawer.tsx");
    const queue = read("./submissions/evaluation/components/review-queue-view.tsx");
    const fileRequests = read("./portal/tasks-admin/components/file-requests-view.tsx");
    const resources = read("./portal/resources/components/resource-pages-admin-view.tsx");

    expect(plans).toContain('actions={\n          <>');
    expect(plans).not.toContain('actions={\n          <span className="row-actions">');
    expect(css).toContain(".row-actions { display: inline-flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }");
    expect(css).toContain("@media(max-width:480px){.admin-task-row>.row-actions{grid-column:2;justify-content:flex-start}}");
    for (const source of [plans, assignment, queue, fileRequests, resources]) {
      expect(source).toContain('className="row-actions"');
    }
  });

  it("separates communications preview metadata from the rendered message", () => {
    const templates = read("./comms/components/templates-tab.tsx");
    const bulk = read("./comms/components/bulk-send-tab.tsx");
    const preview = read("./comms/components/message-preview.tsx");

    for (const source of [templates, bulk]) {
      expect(source).toContain("<MessagePreview");
    }
    expect(preview).toContain('className="template-preview-heading"');
    expect(preview).toContain('className="template-preview-subject"');
    expect(preview).toContain('className="template-preview-body"');
    expect(preview).toContain('className="template-editor__preview message-preview"');
    expect(css).toContain(".message-preview .template-preview-heading{min-height:48px;padding:0 18px;display:flex");
    expect(css).toContain(".message-preview .template-preview-subject{padding:16px 18px 17px");
    expect(css).toContain(".message-preview .template-preview-body{padding:20px 18px}");
    expect(css).not.toContain("\n.template-editor__preview{display:block;padding:0");
  });

  it("does not treat shared speaker avatars as gallery badges", () => {
    expect(css).not.toMatch(/\.speaker-portrait\s*>\s*span\b/gu);
    expect(css).not.toMatch(/\.speaker-portrait\s*>\s*\.person-avatar\s*\{/gu);
    expect(css).toContain(".person-avatar-placeholder {");
  });

  it("does not let speaker-card copy styles override avatars or status pills", () => {
    const detail = read("./portal/components/speakers-admin/speaker-detail-view.tsx");
    const flow = read("./portal/components/speakers-admin/speaker-flow-drawer.tsx");

    expect(css).toContain(".speaker-card-copy b,.speaker-card-copy span,.speaker-card-copy a{display:block}");
    expect(css).not.toContain(".speaker-card b,.speaker-card span,.speaker-card a{display:block}");
    expect(detail).toContain('className="speaker-card-copy"');
    expect(flow).toContain('className="speaker-card-copy"');
  });

  it("scopes speaker-table copy styles away from shared avatar spans", () => {
    const directory = read("./crm/components/directory-view.tsx");
    const speakers = read("./portal/components/speakers-admin/speakers-admin-view.tsx");

    expect(css).toMatch(/\.speaker-table-person-copy\b/gu);
    expect(css).not.toMatch(/\.speaker-table-person(?:\s*>\s*|\s+)(?:b|span|small)\b/gu);
    for (const source of [directory, speakers]) {
      expect(source).toContain('className="speaker-table-person-copy"');
    }
  });

  it("targets the public preview label without restyling its avatar", () => {
    const profile = read("./portal/profile/components/profile-form.tsx");

    expect(profile).toContain('className="public-preview-label"');
    expect(css).toMatch(/\.public-preview-label\b/gu);
    expect(css).not.toMatch(/\.public-preview\s*>\s*span\b/gu);
  });

  it("keeps the portal avatar visible when responsive account copy collapses", () => {
    const portalShell = read("./portal/portal-shell.tsx");

    expect(portalShell).toContain("<Avatar initials={speaker.avatar}");
    expect(portalShell).toContain('className="portal-account-copy"');
    expect(css).toMatch(/\.portal-account\s*>\s*\.portal-account-copy\s*\{\s*display:\s*none/gu);
    expect(css).not.toMatch(/\.portal-account\s*>\s*span\b/gu);
  });

  it("keeps metadata selectors off shared badges and progress tracks", () => {
    const recent = read("./dashboard/components/RecentSubmissionsTable.tsx");
    const tasks = read("./portal/tasks-admin/components/tasks-admin-view.tsx");
    const review = read("./submissions/evaluation/components/review-queue-view.tsx");

    expect(recent).toContain('className="dashboard-recent-source"');
    expect(tasks).toContain('className="admin-task-progress-copy"');
    expect(review).toContain('className="review-progress-copy"');
    expect(css).toContain(".dashboard-recent-source,.dashboard-recent td>small{display:block}");
    expect(css).toContain(".admin-task-progress-copy{display:flex");
    expect(css).toContain(".review-progress-copy{display:flex");
    expect(css).not.toMatch(/\.dashboard-recent\s+td\s*>\s*span\b/gu);
    expect(css).not.toMatch(/\.admin-task-progress\s*>\s*div\b/gu);
    expect(css).not.toMatch(/\.review-progress-card\s*>\s*div\b/gu);
  });

  it("keeps field prose and button variants owned by shared primitives", () => {
    const tray = read("./agenda/components/unscheduled-tray.tsx");

    expect(tray).toContain('<Button size="sm" disabled=');
    expect(css).toContain(".field > small {");
    expect(css).toContain('.form-render .field>strong[role="alert"]');
    expect(css).toContain(".vocab-add>.button{flex:none}");
    expect(css).not.toMatch(/\.field\s+(?:small|strong)\b/gu);
    expect(css).not.toMatch(/\.accepted-tray(?:\s*>?\s*)(?:button|div|span)\b/gu);
    expect(css).not.toContain(".accepted-tray .button");
    expect(css).not.toContain(".vocab-add>button");
  });

  it("keeps metadata selectors from overriding shared status badges", () => {
    const roster = read("./portal/components/speakers-admin/speaker-roster-panels.tsx");
    const flow = read("./portal/components/speakers-admin/speaker-flow-drawer.tsx");
    const detail = read("./portal/components/speakers-admin/speaker-detail-view.tsx");
    const formProgress = read("./dashboard/components/FormProgressCards.tsx");
    const reviewQueue = read("./submissions/evaluation/components/review-queue-view.tsx");
    const formBuilder = read("./forms/form-builder.tsx");

    for (const source of [roster, flow, detail]) {
      expect(source).toContain('className="mini-session-meta"');
    }
    expect(formProgress).toContain('className="dashboard-form-progress-copy"');
    expect(reviewQueue).toContain('className="review-detail-code"');
    expect(formBuilder).toContain('className="inspector-kicker"');

    for (const className of ["mini-session-meta", "dashboard-form-progress-copy", "review-detail-code", "inspector-kicker"]) {
      expect(css).toContain(`.${className}`);
    }
    for (const broadSelector of [
      /\.mini-session\s*>\s*span\b/gu,
      /\.dashboard-form-progress\s+article\s*>\s*header\s+span\b/gu,
      /\.review-detail\s*>\s*header\s*>\s*div:first-child\s*>\s*span\b/gu,
      /\.inspector-content\s*>\s*header\s+span\b/gu,
    ]) {
      expect(css).not.toMatch(broadSelector);
    }
  });

  it("keeps every landing destination available in a compact navigation menu", () => {
    const home = read("../app/page.tsx");
    const mobileNav = read("../app/landing-mobile-nav.tsx");

    expect(css).toContain("@media (max-width: 385px) {");
    expect(css).toContain(".landing-links > a:not(.button) { display: none; }");
    expect(css).toContain(".landing-links > .button-secondary { display: none; }");
    expect(css).toContain(".landing-links { gap: 8px; }");
    expect(css).toContain(".landing-links .button-primary svg { display: none; }");
    expect(css).toContain(".landing-mobile-nav { display: block; }");
    expect(home).toContain("<LandingMobileNav");
    for (const label of ["Platform", "Why Openboard", "Sample call for speakers", "Sign in"]) {
      expect(mobileNav).toContain(label);
    }
    expect(mobileNav).toContain('event.key !== "Escape"');
    expect(css).toContain(
      ".landing-nav > .brand > span:not(.brand-mark) { display: none; }",
    );
    expect(css).toContain(
      ".hero .eyebrow { width: fit-content; max-width: 100%; line-height: 1.35; justify-content: center; }",
    );
  });

  it("lets a table panel shrink below its own table, so the scroller can scroll", () => {
    // .data-panel is a grid item on the settings pages. Without min-width:0 the
    // default min-width:auto floors it at the min-content width of a table that
    // sets white-space:nowrap — so the panel outgrew the viewport, .table-scroll
    // was never narrower than its content and never scrolled, and overflow:clip
    // cut the trailing columns off with no way to reach them. On /account/sessions
    // that hid the IP address, both timestamps, and the Revoke button on a phone.
    expect(css).toContain(".data-panel{overflow:clip;min-width:0}");
    expect(css).toContain(".table-scroll");
  });

  it("keeps a grid's track list matching the children its component renders", () => {
    // Both of these declared more tracks than the markup fills, so a child landed
    // in a slot meant for something else.
    const conditionRow = read("./forms/components/builder/condition-row.tsx");
    const cfpSteps = read("./forms/components/cfp-steps.tsx");

    // The value control is conditional, so the row is three children as often as
    // four; the remove button counts back from the end instead of flowing.
    expect(conditionRow).toContain('className="icon-button condition-row__remove"');
    expect(css).toContain(".condition-row__remove{grid-column:-2}");
    // ...into a 36px track, which is the width .icon-button actually is.
    expect(css).toContain(".condition-row__controls{display:grid;grid-template-columns:1fr 1fr 1fr 36px");

    // The add-participant button renders a title and a description and no icons.
    expect(css).toMatch(/\.add-cospeaker \{[^}]*grid-template-columns: 1fr;/u);
    expect(cfpSteps).toContain("<small>Include another person on this submission.</small>");
  });

  it("makes a disabled icon button look disabled, and stops it lighting up", () => {
    // Without both halves a disabled .icon-button was pixel-identical to a live
    // one and still took the hover treatment, so "Previous" on the first review
    // item read as a control that had simply failed to respond.
    expect(css).toContain(".icon-button:hover:not(:disabled) {");
    expect(css).toContain(".icon-button:disabled { opacity: .55; cursor: not-allowed; }");
  });

  it("uses the button primitive for text-labelled actions, not the 36px icon box", () => {
    const dialog = read("./agenda/components/session-form-dialog.tsx");

    // "Restore"/"Restoring…" is a word, not a glyph: .icon-button is a fixed
    // 36x36 box, so the label spilled outside its own hit area and border.
    expect(dialog).toContain('<Button\n                    size="sm"\n                    variant="ghost"');
    expect(dialog).not.toContain('className="icon-button"');
  });

  it("leaves the builder rail's scroll motion where reduced-motion can reach it", () => {
    const builder = read("./forms/form-builder.tsx");

    // A literal behavior:"smooth" in scrollTo() outruns the preference; the
    // stylesheet's prefers-reduced-motion block already forces scroll-behavior
    // to auto on everything, so the decision belongs in CSS.
    expect(css).toMatch(/\.builder-rail \{[^}]*scroll-behavior: smooth;/u);
    expect(builder).toContain("rail.scrollTo({ left })");
    expect(builder).not.toContain('behavior: "smooth"');
  });

  it("bounds floating and clipped surfaces so their tails stay reachable", () => {
    const profile = read("./portal/profile/components/profile-form.tsx");
    const builder = read("./forms/form-builder.tsx");

    // position:fixed: anything past the bottom edge cannot be scrolled to.
    expect(css).toMatch(/\.tour-coach \{[^}]*max-height: calc\(100vh - 24px\);[^}]*overflow-y: auto;/u);
    // The card's height is the session's duration and its overflow is hidden,
    // so an unclamped title displaced the time label instead of truncating.
    expect(css).toContain(".dv-session-card b{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;");
    // One input, two heights (40px and 44px): centre it rather than offset it.
    expect(css).toContain(".input-icon>svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);");
    // The ellipsis is part of the truncation, not decoration on every preview.
    expect(profile).toContain("characters.length > 140 ?");
    expect(profile).not.toContain("${plainTextPreview(bioHtml)}\u2026");
    expect(builder).toContain('live question{section.fields.length === 1 ? "" : "s"}');
  });

  it("lets the recovery banner stack instead of pushing the page sideways", () => {
    // Icon + paragraph + two nowrap buttons has a min-content width of ~376px,
    // so on a 360px screen the banner stopped shrinking and moved the document
    // instead — putting its own recovery actions 47px off the right edge. It is
    // shared by eight surfaces, including the only way out of an unconfirmed
    // session revoke or event-access grant.
    expect(css).toContain(".locked-banner{display:grid;grid-template-columns:auto minmax(0,1fr)");
    expect(css).toContain(".locked-banner>.button{grid-column:1/-1;width:100%}");
  });

  it("styles the two lists that were rendering browser defaults", () => {
    const taskDetail = read("./portal/task-runtime/components/task-detail.tsx");
    const filesAdmin = read("./portal/deliverables/components/files-admin-view.tsx");
    const sessionDialog = read("./agenda/components/session-form-dialog.tsx");
    const logSheet = read("./comms/components/log-detail-sheet.tsx");

    // .portal-uploads had three call sites and no rule at all: bullets, with the
    // icon, filename, timestamp and badge run together on one line.
    for (const source of [taskDetail, filesAdmin, sessionDialog]) {
      expect(source).toContain('className="portal-uploads"');
    }
    expect(css).toContain(".portal-uploads{list-style:none;");
    expect(css).toContain(".portal-uploads>li{display:flex;");
    // The middle takes the truncation so a long filename cannot push the badge out.
    expect(css).toContain(".portal-uploads>li>span,.portal-uploads>li>a{flex:1;min-width:0;");

    // The message detail's dl rendered as default indented pairs.
    expect(logSheet).toContain('className="comm-detail"');
    expect(css).toContain(".comm-detail dl{display:grid;");
    expect(css).toContain(".comm-detail dl>div{display:flex;justify-content:space-between;");
  });

  it("keeps the Files filter strip on one row like every other list toolbar", () => {
    const filesAdmin = read("./portal/deliverables/components/files-admin-view.tsx");
    const speakersAdmin = read("./portal/components/speakers-admin/speakers-admin-view.tsx");

    // The base rule is `select{width:100%}`, so an unclassed filter in the one
    // toolbar that wraps takes a flex basis of the whole row: three filters,
    // three 1106px-wide stacked lines. `.compact-select` is the idiom the rest
    // of the app's list toolbars already use.
    expect(speakersAdmin).toContain('className="compact-select"');
    // Every select inside the strip, rather than a fixed count of them: a
    // fourth filter added the same way should keep this green, and one added
    // without the class should not.
    const toolbarStart = filesAdmin.indexOf('className="data-toolbar files-data-toolbar"');
    const toolbarEnd = filesAdmin.indexOf('<span className="row-count">', toolbarStart);
    expect(toolbarStart).toBeGreaterThan(-1);
    expect(toolbarEnd).toBeGreaterThan(toolbarStart);
    const toolbar = filesAdmin.slice(toolbarStart, toolbarEnd);
    const filters = toolbar.match(/<Select\b/gu) ?? [];
    expect(filters.length).toBeGreaterThanOrEqual(3);
    expect(toolbar.match(/<Select className="compact-select"/gu)).toHaveLength(filters.length);
    expect(css).toContain(".compact-select{width:auto;");
    // Its options are event data, not a fixed vocabulary, so one long file
    // request title must not become the whole toolbar.
    expect(css).toContain(".files-data-toolbar .compact-select{max-width:190px}");
  });

  it("keeps short session cards, the bulk bar's Clear, and the mobile nav honest", () => {
    const bulkBar = read("../shared/ui/app/bulk-action-bar.tsx");
    const shell = read("./shell/admin-shell.tsx");

    // A sub-22-minute session gets one 16px grid row, and the card clips its own
    // overflow — so an absolutely positioned conflict badge was the thing cut.
    expect(css).toContain(".dv-session-card--compact .dv-session-card-conflict-icon,.dv-session-card--single-line .dv-session-card-conflict-icon{position:static;");

    // `trailing` renders after Clear whenever a decision is queued to notify, so
    // :last-child dressed Send as the quiet button and Clear as the loud one.
    expect(bulkBar).toContain('className="bulk-bar-clear"');
    expect(css).toContain(".bulk-bar>.bulk-bar-clear{");
    expect(css).not.toContain(".bulk-bar>button:last-child{");

    // The nav is an overlay, not a <dialog>, so nothing stopped the page behind
    // it from scrolling under a drag on the scrim.
    expect(css).toMatch(/\.sidebar-nav \{[^}]*overscroll-behavior: contain;/u);
    expect(shell).toContain('document.documentElement.style.overflow = "hidden"');
    expect(shell).toContain("document.documentElement.style.overflow = overflow;");
  });

  it("lets the announce bundle's copy rows shrink to the dialog they sit in", () => {
    // Every value is a URL, `.announce-copy-row code` is nowrap, and a grid
    // item's default min-width is its min-content — so the section grew to the
    // longest per-speaker share link and carried its Copy button outside the
    // modal. The floors are what let the existing ellipsis fire.
    expect(css).toContain(".announce-bundle{display:grid;gap:24px;min-width:0}");
    expect(css).toContain(".announce-bundle>section{min-width:0}");
    expect(css).toContain(".announce-speaker-links>li{min-width:0}");
    expect(css).toContain(".announce-copy-row>div{flex:1;min-width:0}");
  });

  it("gives the submissions title column a floor, not just a ceiling", () => {
    const table = read("./submissions/components/abstracts-table.tsx");

    // Auto table layout satisfies every nowrap column first and hands the
    // deficit to the only column that wraps; a max-width alone collapsed it to
    // its longest word.
    expect(table).toContain('meta: { className: "abstracts-title-column" }');
    // Not `abstracts-col-*`: that namespace is the responsive disclosure
    // ladder, and abstracts-table.test.ts pins Title out of it.
    expect(table).not.toContain("abstracts-col-title");
    expect(css).toContain(
      ".data-table th.abstracts-title-column,.data-table td.abstracts-title-column{width:340px;min-width:280px}",
    );
    // Title and description share the clamp: one 300-character probe title
    // wrapped to twelve lines and set the row height on its own. The title half
    // is scoped to this column — `.submission-title-cell` is also the comms log
    // recipient, suppressions and the agenda list view, and the ≤768px comms
    // override below depends on that `b` staying a block box for its ellipsis.
    expect(css).toContain(
      ".abstracts-title-column .submission-title-cell b,.submission-title-cell span{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}",
    );
    // …and the clamp never reaches a bare `.submission-title-cell b`, which is
    // how it would find the other four tables again.
    expect(css).not.toMatch(/(?<!\.abstracts-title-column )\.submission-title-cell b[,{][^{}]*display:-webkit-box/u);
  });

  it("gives the evaluation plan row actions a floor, not just a ceiling", () => {
    const plans = read("./submissions/evaluation/components/plans-view.tsx");

    // Same defect as the abstracts title column above, mirrored: auto table
    // layout satisfies every nowrap column first and hands the deficit to the
    // only column that can still shrink. There it collapsed the Title column;
    // here it left Assign/Remind/Edit on one line and wrapped Delete alone
    // onto a second, orphaned and right-aligned into empty space even at
    // 1440px, where there was room for all four.
    expect(plans).toContain('meta: { className: "plan-actions-column" }');
    expect(css).toContain(".data-table td.plan-actions-column .row-actions{flex-wrap:nowrap}");
    // The shared class's own wrap behavior stays intact — `.admin-task-row`
    // cards and every other `.row-actions` group still fall back to wrapping
    // on a narrow viewport; only this column's four-button cluster is pinned
    // to one row, falling back to the table's own horizontal scroll instead.
    expect(css).toContain(".row-actions { display: inline-flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }");
  });

  it("keeps a table toolbar's search from being squeezed by its filters", () => {
    expect(css).toContain(".data-toolbar>.table-search{flex:0 0 280px}");
    expect(css).toContain(".data-toolbar>.filter-button{min-width:0}");
    // T5 allows max-width breakpoints only, so the phone shape is an override
    // rather than a min-width band.
    expect(css).toContain(".data-toolbar>.table-search{flex:1 1 100%}");
    expect(css).not.toMatch(/@media\(min-width/u);
  });

  // MTP-07 §1.5 — both unscheduled trays style every descendant span of their
  // row at (0,1,1), which outranks the chip's own (0,1,0) rules: without a
  // scoped restatement the danger chip renders as a full-width muted-grey block
  // on its red background, in the two surfaces the mark matters most.
  it("keeps the abstract-divergence chip's tone and shape inside both unscheduled trays", () => {
    const tray = read("./agenda/components/unscheduled-tray.tsx");
    const panel = read("./agenda/components/day-view/unscheduled-panel.tsx");
    expect(tray).toContain("<AbstractDivergenceChip session={session} />");
    expect(panel).toContain("<AbstractDivergenceChip session={session} />");
    // The tone rides on a custom property, so the scoped rules re-assert one
    // declaration instead of duplicating the red/amber pair.
    expect(css).toContain(".agenda-divergence-chip--danger{--divergence-ink:var(--red);background:var(--red-soft)}");
    expect(css).toContain(".agenda-divergence-chip--warning{--divergence-ink:var(--amber);background:var(--amber-soft)}");
    expect(css).toContain(
      ".unscheduled-tray>button .agenda-divergence-chip,.dv-unscheduled-card .agenda-divergence-chip{display:inline-flex;margin-top:4px;color:var(--divergence-ink)}",
    );
    expect(css).toContain(
      ".unscheduled-tray>button .agenda-divergence-chip>span,.dv-unscheduled-card .agenda-divergence-chip>span{display:inline;margin-top:0;color:inherit}",
    );
  });

  it("lays the speaker task filter beside the tabs, not boxed inside a boxed select", () => {
    // `.table-search` draws its own bordered pill for a search-icon + input
    // pairing; wrapping it around an already-bordered `.select-control`
    // nested two boxes with mismatched heights around the "Open" dropdown.
    // `.tab-row` had no layout rule of its own either, so its buttons fell
    // back to block flow and stacked vertically instead of sitting beside the
    // filter (#646).
    const taskList = read("./portal/task-runtime/components/task-list.tsx");
    expect(taskList).not.toContain('className="table-search"');
    expect(taskList.match(/<Select\b/gu)).toHaveLength(1);
    expect(css).toContain(".abstract-status-tabs .tab-row{display:flex;align-items:stretch;gap:4px;flex:1;min-width:0}");
    expect(css).toContain(".abstract-status-tabs>.select-control{");
  });

  it("pads portal panels and keeps a task's description in the same card as its action", () => {
    // `.portal-panel` carried background/border/radius/shadow but never a
    // padding rule, so every consumer's text and buttons sat flush against
    // the box edge. The task detail page also split a task's description
    // into its own panel ahead of the completion action, so two boxes with
    // no gap between them read as one card with a stray divider line, and
    // the action panel — holding only a button — looked like a mostly-empty
    // box below it (#646).
    const taskDetail = read("./portal/task-runtime/components/task-detail.tsx");
    expect(css).toContain(".portal-panel{padding:24px;");
    expect(taskDetail).not.toContain('{task.descriptionHtml && <div className="portal-panel">');
    // Once per completion-mode panel (manual, file_request, form-not-ready,
    // form-ready) — a leading child of each, not a fifth panel of its own.
    expect(taskDetail.match(/\{task\.descriptionHtml && <RichTextView html=\{task\.descriptionHtml\} \/>\}/gu)).toHaveLength(4);
  });

  it("styles the badge/due-date row wherever it appears, not just inside a task card", () => {
    // `.portal-task-card>div>div` only matched `.portal-task-meta` nested
    // three levels inside a task card. The task detail header uses the same
    // class directly under `.portal-page-header`, where that selector never
    // reached it — the badges sat flush against each other with no gap and
    // the due date wrapped onto its own cramped line underneath (#646).
    const taskDetail = read("./portal/task-runtime/components/task-detail.tsx");
    const taskList = read("./portal/task-runtime/components/task-list.tsx");
    expect(taskDetail).toContain('className="portal-task-meta"');
    expect(taskList).toContain('className="portal-task-meta"');
    expect(css).toMatch(/\.portal-task-meta\s*\{display:flex/u);
    expect(css).not.toContain(".portal-task-card>div>div{");
  });

  it("vertically centers the footer's link and plain-text sibling on the same baseline", () => {
    // `.portal-site-footer div div a` carries a 32px touch-target floor that
    // `<span>Powered by Openboard</span>` never gets, so without align-items
    // on their shared flex row the two texts sat ~10px apart: the anchor
    // centered inside its own taller box, the span stretched to match it and
    // kept its text pinned to the top.
    expect(css).toMatch(/\.portal-site-footer div div\s*\{[^}]*align-items:\s*center/u);
  });

  it("gives the portal's bounced edit-unavailable notice the same weight as other page-level alerts", () => {
    const page = read("../app/portal/[eventSlug]/submissions/[submissionId]/page.tsx");

    // A speaker who follows a stale /edit link and bounces back used to see
    // this as plain `.portal-note` text — the same muted style used for dozens
    // of low-stakes hints, easy to miss as feedback for a real navigation.
    expect(page).toContain('className="portal-bounce-notice"');
    expect(page).not.toContain('className="portal-note" role="status">{notice}');
    expect(css).toContain(".portal-bounce-notice{display:flex;align-items:center;gap:8px;margin-bottom:16px;padding:12px 16px;border:1px solid var(--amber-border);border-radius:9px;background:var(--amber-soft);color:var(--amber)");
  });

  it("shows the speaker profile's bio character count exactly once", () => {
    const profile = read("./portal/profile/components/profile-form.tsx");

    // RichTextEditor already renders its own "used / max" counter for any
    // `maxChars` editor (`rich-text-editor.tsx`'s `.rich-text-editor__count`).
    // The Biography field's Field wrapper duplicated it as a `hint`, so the
    // count appeared twice: once inside the editor's own corner, once again
    // as the field hint directly below it.
    expect(profile).toContain('<Field label="Biography" error={bioError} errorId="profile-bio-error">');
    expect(profile).not.toContain("characters`}");
  });

  it("keeps a single 'Public preview' card on the profile sidebar", () => {
    const profile = read("./portal/profile/components/profile-form.tsx");

    // A whole second card — icon, "Public preview" heading, explainer
    // paragraph — used to sit directly above the actual preview card, which
    // has its own "PUBLIC PREVIEW" eyebrow label. The explainer now lives as
    // a caption inside the one card that does the previewing.
    expect(profile).not.toContain("profile-readiness");
    // Case-sensitive: "PUBLIC PREVIEW" (the surviving card's eyebrow label)
    // must stay, only the duplicated "Public preview" heading is gone.
    expect(profile).not.toContain("Public preview");
    expect(profile).toContain("PUBLIC PREVIEW");
    expect(profile).toContain('className="public-preview-hint"');
    expect(css).toContain(".public-preview-hint{");
    expect(css).not.toMatch(/\.profile-readiness\b/u);
  });

  it("gives discrete public session and gallery actions full pointer targets", () => {
    expect(css).toContain(
      ".public-session-main h3 button{width:100%;min-height:32px;",
    );
    expect(css).toContain(
      ".session-card-toggle,.speaker-gallery footer button,.speaker-gallery footer a{min-height:32px}",
    );
    expect(css).toContain(
      ".public-session-main h3 button,.session-card-toggle,.speaker-gallery footer button,.speaker-gallery footer a{min-height:44px}",
    );
  });
});
