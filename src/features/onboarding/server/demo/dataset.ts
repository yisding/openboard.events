import type { ConfirmationStatus, ParticipantRole, SubmissionStatus, TemplateKey } from "@/shared/contracts";

/**
 * The "First Fair" demo world's content (design §2.4, §2.5).
 *
 * Pure data. This module imports nothing but types — no `@/db/*`, no
 * `drizzle-orm`, no other feature's runtime code — so it can be unit-tested
 * with zero database and is safe to `import()` lazily from inside a phase
 * runner without dragging anything server-heavy along with it
 * (`build:worker`'s size budget, design §8.7).
 *
 * Every timestamp is an *offset*, never a literal date: `offsetDays` here,
 * `demoLocal(now, offsetDays, "HH:MM")` in `clock.ts` at write time. That is
 * what "pure function of `now`" (§2.5) means in practice — this file has no
 * `Date` objects in it at all, so nothing here can rot.
 *
 * Authored from `aie-worlds-fair-research.md` §2/§4/§5 — the invented,
 * in-style material only. Every speaker, company and bio below is fictional;
 * none of it should ever be presented as describing a real person or a real
 * past AI Engineer World's Fair session.
 *
 * `scripts/seed/*` keeps its own, separate arrays (design §2.1): the seed
 * deliberately contains hostile probes (XSS payloads, an all-NULL row, a
 * 255-char title) that a demo-event visitor must never meet, and `src` must
 * never import `scripts/`. The ~220-line duplication between the two content
 * sets buys complete decoupling.
 */

// ---------------------------------------------------------------------------
// Vocabulary: tracks, rooms, formats, tags
// ---------------------------------------------------------------------------

export type DemoTrack = { key: string; name: string; color: string };

/** Blends the 2025 CFP's real track list with the 2026 category expansions
 *  (research §2) into eight tracks — enough variety for the schedule to feel
 *  like a real multi-track conference without spreading 24 submissions too
 *  thin to ever collide. */
export const TRACKS: readonly DemoTrack[] = [
  { key: "agentic-engineering", name: "Agentic Engineering", color: "#6958d7" },
  { key: "mcp", name: "Model Context Protocol", color: "#2f8f5b" },
  { key: "evals", name: "Evals", color: "#b6742a" },
  { key: "context-engineering", name: "Context Engineering", color: "#c04b6a" },
  { key: "security", name: "Security", color: "#7a4fb5" },
  { key: "voice-realtime-ai", name: "Voice & Realtime AI", color: "#2687a8" },
  { key: "robotics-world-models", name: "Robotics & World Models", color: "#a45d2c" },
  { key: "agentic-commerce", name: "Agentic Commerce", color: "#4a7c3f" },
] as const;

export type DemoRoom = { key: string; name: string; capacity: number };

export const ROOMS: readonly DemoRoom[] = [
  { key: "main-stage", name: "Main Stage", capacity: 1200 },
  { key: "embarcadero", name: "Embarcadero", capacity: 450 },
  { key: "mission-room", name: "Mission Room", capacity: 220 },
  { key: "workshop-studio-a", name: "Workshop Studio A", capacity: 90 },
  { key: "expo-stage", name: "Expo Stage", capacity: 300 },
] as const;

export type DemoFormat = { key: string; name: string; defaultDurationMins: number };

/** `Talk` is 18 minutes — the real AIEWF signature slot length (research
 *  §3) — deliberately kept even though `seedEventDefaultsIn`'s own default
 *  formats use a rounder 30. */
export const FORMATS: readonly DemoFormat[] = [
  { key: "keynote", name: "Keynote", defaultDurationMins: 40 },
  { key: "talk", name: "Talk", defaultDurationMins: 18 },
  { key: "workshop", name: "Workshop", defaultDurationMins: 90 },
  { key: "panel", name: "Panel", defaultDurationMins: 45 },
  { key: "lightning", name: "Lightning Talk", defaultDurationMins: 8 },
  { key: "debate", name: "The Great AI Debate", defaultDurationMins: 45 },
] as const;

export type DemoTag = { key: string; name: string };

export const TAGS: readonly DemoTag[] = [
  { key: "tag-evals", name: "Evals" },
  { key: "tag-security", name: "Security" },
  { key: "tag-open-source", name: "Open Source" },
  { key: "tag-enterprise", name: "Enterprise" },
  { key: "tag-voice", name: "Voice" },
  { key: "tag-robotics", name: "Robotics" },
] as const;

/** The one CFP routing rule: a Security-track proposal is automatically
 *  flagged for the enterprise sponsor track, no organizer click required.
 *  Effect only — it never rewrites the track the speaker chose. */
export type DemoRoutingRule = {
  formKey: "cfp";
  matchTrackKey: string;
  addTagKeys: readonly string[];
};

export const ROUTING_RULES: readonly DemoRoutingRule[] = [
  { formKey: "cfp", matchTrackKey: "security", addTagKeys: ["tag-enterprise"] },
] as const;

// ---------------------------------------------------------------------------
// People: the 18 fictional speakers (research §5)
// ---------------------------------------------------------------------------

export type DemoSpeaker = {
  key: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  /** `null` means the contact record itself has no company on file — three
   *  speakers are deliberately incomplete here even though their bio prose
   *  names an employer, mirroring real CRM data (design §2.4: "3 with no
   *  company"). */
  company: string | null;
  /** Always populated, even when `company` is null: the fictional employer
   *  (or "independent") still owns the email domain. */
  emailDomainSlug: string;
  bioHtml: string | null;
  confirmationStatus: ConfirmationStatus;
};

/**
 * Deliberately uneven, the same way `scripts/seed/contacts.ts` is: eleven
 * confirmed / five unconfirmed / two declined; four with no bio; three with
 * no company; **zero** with a headshot (`contacts.headshot_file_id` is left
 * `null` for all eighteen — design §2.4's "the payload", not an oversight).
 */
export const SPEAKERS: readonly DemoSpeaker[] = [
  {
    key: "dana-whitfield", firstName: "Dana", lastName: "Whitfield", jobTitle: "Head of AI Platform",
    company: "Northline Systems", emailDomainSlug: "northline", bioHtml: null, confirmationStatus: "unconfirmed",
  },
  {
    key: "marcus-iyer", firstName: "Marcus", lastName: "Iyer", jobTitle: "Founding Engineer",
    company: "Reedwood AI", emailDomainSlug: "reedwood",
    bioHtml: "<p>Built Reedwood’s retrieval stack from a weekend prototype into the backbone of its enterprise search product.</p>",
    confirmationStatus: "confirmed",
  },
  {
    key: "priya-kalburgi", firstName: "Priya", lastName: "Kalburgi", jobTitle: "VP of AI Engineering",
    company: "Cascade Freight Corp", emailDomainSlug: "cascadefreight",
    bioHtml: "<p>Runs a 30-person AI org bringing agentic routing and forecasting to a 100-year-old logistics company.</p>",
    confirmationStatus: "confirmed",
  },
  {
    key: "tomas-reyes", firstName: "Tomas", lastName: "Reyes", jobTitle: "Staff ML Engineer",
    company: "Fenwick Labs", emailDomainSlug: "fenwick",
    bioHtml: "<p>Specializes in post-training pipelines and RLHF tooling for mid-size open-weight models.</p>",
    confirmationStatus: "confirmed",
  },
  {
    key: "aisha-bello", firstName: "Aisha", lastName: "Bello", jobTitle: "Founder & CEO",
    company: "Loomstack", emailDomainSlug: "loomstack",
    bioHtml: "<p>Started Loomstack to give small dev teams production-grade eval infrastructure without a data-science hire.</p>",
    confirmationStatus: "confirmed",
  },
  {
    key: "kenji-watari", firstName: "Kenji", lastName: "Watari", jobTitle: "Principal Engineer, Voice AI",
    company: "Amberline", emailDomainSlug: "amberline",
    bioHtml: "<p>Designed the low-latency speech pipeline powering Amberline’s real-time voice-agent product.</p>",
    confirmationStatus: "confirmed",
  },
  {
    key: "elena-torkelson", firstName: "Elena", lastName: "Torkelson", jobTitle: "Director of Applied AI",
    company: "Brightfjord Health", emailDomainSlug: "brightfjord",
    bioHtml: "<p>Owns clinical-workflow AI deployments across a 12-hospital network; a frequent voice on AI-in-healthcare compliance.</p>",
    confirmationStatus: "confirmed",
  },
  {
    key: "sam-odoyle", firstName: "Sam", lastName: "O'Doyle", jobTitle: "Independent Consultant",
    company: null, emailDomainSlug: "independent",
    bioHtml: "<p>Advises Series A–C startups on agent reliability and context-engineering practices after a decade in infra.</p>",
    confirmationStatus: "confirmed",
  },
  {
    key: "renata-souza", firstName: "Renata", lastName: "Souza", jobTitle: "Head of Developer Relations",
    company: "Vellumatic", emailDomainSlug: "vellumatic",
    bioHtml: "<p>Explains MCP internals and agent tooling to a developer audience of 200k+ newsletter subscribers.</p>",
    confirmationStatus: "unconfirmed",
  },
  {
    key: "owen-fairweather", firstName: "Owen", lastName: "Fairweather", jobTitle: "CTO",
    company: "Grainhouse", emailDomainSlug: "grainhouse",
    bioHtml: "<p>Oversees Grainhouse’s shift from rules-based underwriting to an agentic decisioning system in fintech.</p>",
    confirmationStatus: "confirmed",
  },
  {
    key: "naledi-mokoena", firstName: "Naledi", lastName: "Mokoena", jobTitle: "Research Scientist",
    company: "Halcyon Robotics", emailDomainSlug: "halcyon", bioHtml: null, confirmationStatus: "unconfirmed",
  },
  {
    key: "victor-achebe", firstName: "Victor", lastName: "Achebe", jobTitle: "Security Lead, AI Systems",
    company: "Ferro Defense Labs", emailDomainSlug: "ferrodefense",
    bioHtml: "<p>Red-teams autonomous coding and browsing agents before they reach enterprise customers.</p>",
    confirmationStatus: "confirmed",
  },
  {
    key: "claire-bijlsma", firstName: "Claire", lastName: "Bijlsma", jobTitle: "Product Manager, Agents",
    company: "Northline Systems", emailDomainSlug: "northline",
    bioHtml: "<p>Bridges PM and engineering on Northline’s agent roadmap; a former backend engineer turned PM.</p>",
    confirmationStatus: "unconfirmed",
  },
  {
    key: "devraj-anand", firstName: "Devraj", lastName: "Anand", jobTitle: "Founder",
    company: "Kestrel Data", emailDomainSlug: "kestrel", bioHtml: null, confirmationStatus: "confirmed",
  },
  {
    key: "yuki-tanabe", firstName: "Yuki", lastName: "Tanabe", jobTitle: "ML Infra Lead",
    company: "Cindermount", emailDomainSlug: "cindermount",
    bioHtml: "<p>Cut GPU inference costs 60% at Cindermount through batching and speculative decoding work.</p>",
    confirmationStatus: "confirmed",
  },
  {
    key: "grace-odumosu", firstName: "Grace", lastName: "Odumosu", jobTitle: "Head of AI, GTM",
    company: null, emailDomainSlug: "loomstack",
    bioHtml: "<p>Applies agentic workflows to sales and customer-success motions; writes about \"agents that touch revenue.\"</p>",
    confirmationStatus: "declined",
  },
  {
    key: "bastian-kroll", firstName: "Bastian", lastName: "Kroll", jobTitle: "Distinguished Engineer",
    company: null, emailDomainSlug: "fenwick", bioHtml: null, confirmationStatus: "unconfirmed",
  },
  {
    key: "mira-papadakis", firstName: "Mira", lastName: "Papadakis", jobTitle: "Founder & Chief Scientist",
    company: "Halcyon Robotics", emailDomainSlug: "halcyon",
    bioHtml: "<p>Left academia to build embodied-agent systems that combine LLM planning with classical control.</p>",
    confirmationStatus: "declined",
  },
] as const;

// ---------------------------------------------------------------------------
// Forms: the two CFP forms (research §6)
// ---------------------------------------------------------------------------

export type DemoFieldVisibility = { sourceFieldKey: string; op: "eq"; value: string };

export type DemoFormField = {
  key: string;
  sectionKey: "abstract" | "participant";
  label: string;
  fieldType: "text" | "textarea" | "richtext" | "dropdown" | "multiselect" | "email";
  required?: true;
  locked?: true;
  maxChars?: number;
  mapsTo?: string;
  /** Fail-closed default is `"identity"`: a blind reviewer only sees an
   *  answer where an organizer has deliberately said it is proposal content
   *  (design's M50 note, carried into the demo so Ch5's blind round has
   *  something real to demonstrate). `approach` opts in; every other custom
   *  question here keeps the default, which is the "pair" the tour points
   *  at — one question showing each side of the switch. */
  reviewVisibility?: "content";
  /** Bound to a vocabulary list at write time rather than a hand-authored
   *  option list, so the field always reflects `TRACKS`/`FORMATS`/`TAGS`. */
  optionSource?: "track" | "format" | "tag";
  /** The one conditional field (design §2.4): visible only when the
   *  proposal's format is a workshop. */
  visibility?: DemoFieldVisibility;
};

export type DemoForm = {
  key: "cfp" | "expo-lightning";
  internalName: string;
  externalTitle: string;
  pageHeading: string;
  status: "open" | "closed";
  opensOffsetDays: number;
  closesOffsetDays: number;
  submissionLimit: number | null;
  welcomeHtml: string;
  fields: readonly DemoFormField[];
};

export const FORMS: readonly DemoForm[] = [
  {
    key: "cfp",
    internalName: "Speak at AI Engineer World’s Fair",
    externalTitle: "Speak at AI Engineer World’s Fair",
    pageHeading: "Submission",
    status: "open",
    opensOffsetDays: -20,
    closesOffsetDays: 12,
    submissionLimit: 3,
    welcomeHtml: "<p>Multiple submissions are welcome — one per topic. We desk-reject talks that are lazy shills for your product; bring real-life experience, real user data, and product-market fit.</p>",
    fields: [
      { key: "title", sectionKey: "abstract", label: "Title", fieldType: "text", required: true, locked: true, maxChars: 255, mapsTo: "submission.title" },
      { key: "description", sectionKey: "abstract", label: "Description", fieldType: "richtext", required: true, maxChars: 5000, mapsTo: "submission.description_html" },
      { key: "track", sectionKey: "abstract", label: "Track", fieldType: "dropdown", required: true, optionSource: "track", mapsTo: "submission.track_id" },
      { key: "format", sectionKey: "abstract", label: "Format", fieldType: "dropdown", required: true, optionSource: "format", mapsTo: "submission.format_id" },
      // The conditional field: appears only once `format` is answered "Workshop".
      { key: "workshop_duration", sectionKey: "abstract", label: "Workshop duration", fieldType: "text", maxChars: 255, visibility: { sourceFieldKey: "format", op: "eq", value: "workshop" } },
      { key: "topics", sectionKey: "abstract", label: "Topics", fieldType: "multiselect", optionSource: "tag" },
      // Half one of the reviewVisibility pair: proposal content a blind reviewer should read.
      { key: "approach", sectionKey: "abstract", label: "Approach", fieldType: "textarea", maxChars: 1000, reviewVisibility: "content" },
      { key: "first_name", sectionKey: "participant", label: "First name", fieldType: "text", required: true, locked: true, mapsTo: "contact.first_name" },
      { key: "last_name", sectionKey: "participant", label: "Last name", fieldType: "text", required: true, locked: true, mapsTo: "contact.last_name" },
      { key: "email", sectionKey: "participant", label: "Email", fieldType: "email", required: true, locked: true, mapsTo: "contact.email" },
      // Half two of the pair: an ordinary custom question nobody classified,
      // so it keeps the fail-closed "identity" default.
      { key: "company", sectionKey: "participant", label: "Company", fieldType: "text", maxChars: 255, mapsTo: "contact.company" },
    ],
  },
  {
    key: "expo-lightning",
    internalName: "Expo Stage Lightning Talks",
    externalTitle: "Expo Stage Lightning Talks",
    pageHeading: "Lightning",
    status: "closed",
    opensOffsetDays: -40,
    closesOffsetDays: -5,
    submissionLimit: 1,
    welcomeHtml: "<p>Eight minutes, one idea, the Expo Stage. This round has closed — thank you to everyone who threw their hat in.</p>",
    fields: [
      { key: "title", sectionKey: "abstract", label: "Title", fieldType: "text", required: true, locked: true, maxChars: 255, mapsTo: "submission.title" },
      { key: "description", sectionKey: "abstract", label: "Description", fieldType: "richtext", maxChars: 1000, mapsTo: "submission.description_html" },
      { key: "format", sectionKey: "abstract", label: "Format", fieldType: "dropdown", optionSource: "format", mapsTo: "submission.format_id" },
      { key: "first_name", sectionKey: "participant", label: "First name", fieldType: "text", required: true, locked: true, mapsTo: "contact.first_name" },
      { key: "last_name", sectionKey: "participant", label: "Last name", fieldType: "text", required: true, locked: true, mapsTo: "contact.last_name" },
      { key: "email", sectionKey: "participant", label: "Email", fieldType: "email", required: true, locked: true, mapsTo: "contact.email" },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Submissions: the 24 proposals
// ---------------------------------------------------------------------------

export type DemoParticipant = { speakerKey: string; role: ParticipantRole; isPrimary: boolean };

export type DemoSubmission = {
  key: string;
  title: string;
  descriptionHtml: string;
  formKey: "cfp" | "expo-lightning";
  trackKey: string;
  formatKey: string;
  level?: "Beginner" | "Intermediate" | "Advanced";
  tagKeys?: readonly string[];
  participants: readonly DemoParticipant[];
  status: SubmissionStatus;
  /** Relative to `now`; always negative — every submission was submitted (or,
   *  for the two drafts, started) in the past. */
  createdOffsetDays: number;
  /** Only set for the one workshop proposal, so the conditional CFP field
   *  has a real answer behind it. */
  workshopDurationAnswer?: string;
};

const speaker = (speakerKey: string, role: ParticipantRole = "speaker", isPrimary = true): DemoParticipant => ({ speakerKey, role, isPrimary });
const coSpeaker = (speakerKey: string): DemoParticipant => ({ speakerKey, role: "co_speaker", isPrimary: false });
const panelist = (speakerKey: string): DemoParticipant => ({ speakerKey, role: "panelist", isPrimary: false });

/**
 * Twenty-four proposals across all seven `SUBMISSION_STATUSES` (two of them
 * drafts), −35 d…−2 d, six with a co-speaker. Twenty of the titles are the
 * research doc's invented in-style set (§4) — the same twenty become the
 * agenda's twenty sessions once "accepted", so a title an organizer meets
 * in the review queue is the same title they later meet on the schedule.
 * The other four exist to make the funnel real: a near-duplicate MCP pitch,
 * the transparent vendor pitch, and two still-drafting proposals.
 */
export const SUBMISSIONS: readonly DemoSubmission[] = [
  {
    key: "keynote-agentic-stack", title: "Keynote: The Agentic Engineering Stack, One Year Later",
    descriptionHtml: "<p>A year of shipped agent platforms, reviewed honestly: what the hype got right, what quietly died.</p>",
    formKey: "cfp", trackKey: "agentic-engineering", formatKey: "keynote", level: "Intermediate",
    participants: [speaker("bastian-kroll")], status: "accepted", createdOffsetDays: -35,
  },
  {
    key: "context-engineering", title: "Context Engineering Is the New Prompt Engineering",
    descriptionHtml: "<p>Why the hard problem moved from wording the prompt to curating everything around it.</p>",
    formKey: "cfp", trackKey: "context-engineering", formatKey: "talk", level: "Intermediate",
    tagKeys: ["tag-open-source"], participants: [speaker("sam-odoyle")], status: "accepted", createdOffsetDays: -34,
  },
  {
    key: "evals-product-requirement", title: "Evals as a Product Requirement, Not an Afterthought",
    descriptionHtml: "<p>Treating an eval suite as a shipped deliverable instead of a research side project.</p>",
    formKey: "cfp", trackKey: "evals", formatKey: "talk", level: "Intermediate",
    tagKeys: ["tag-evals"], participants: [speaker("aisha-bello")], status: "accepted", createdOffsetDays: -33,
  },
  {
    key: "shipping-mcp-servers", title: "Shipping MCP Servers Into Production Without Regretting It",
    descriptionHtml: "<p>The operational lessons that only show up once real traffic hits an MCP server.</p>",
    formKey: "cfp", trackKey: "mcp", formatKey: "talk", level: "Advanced",
    participants: [speaker("marcus-iyer")], status: "accepted", createdOffsetDays: -32,
  },
  {
    key: "reasoning-rl", title: "Reasoning Models in the Loop: When RL Post-Training Actually Pays Off",
    descriptionHtml: "<p>Where GRPO-style post-training earned its compute budget, and where it quietly didn’t.</p>",
    formKey: "cfp", trackKey: "agentic-engineering", formatKey: "talk", level: "Advanced",
    participants: [speaker("tomas-reyes")], status: "accepted", createdOffsetDays: -31,
  },
  {
    key: "graphrag-50m-nodes", title: "GraphRAG at 50M Nodes: Lessons From a Real Enterprise Rollout",
    descriptionHtml: "<p>Scaling a knowledge-graph-backed retrieval system past the point where demos usually stop.</p>",
    formKey: "cfp", trackKey: "context-engineering", formatKey: "talk", level: "Advanced",
    participants: [speaker("devraj-anand")], status: "accept_queue", createdOffsetDays: -30,
  },
  {
    key: "computer-use-agents", title: "Computer-Use Agents That Don’t Fall Over on Real Websites",
    descriptionHtml: "<p>The failure modes that only show up once an agent leaves a curated demo environment.</p>",
    formKey: "cfp", trackKey: "agentic-engineering", formatKey: "talk", level: "Intermediate",
    participants: [speaker("claire-bijlsma"), coSpeaker("priya-kalburgi")], status: "accepted", createdOffsetDays: -29,
  },
  {
    key: "voice-agents-300ms", title: "Voice Agents Under 300ms: An Infra Deep Dive",
    descriptionHtml: "<p>The latency budget breakdown behind a voice agent that feels like a phone call, not a chatbot.</p>",
    formKey: "cfp", trackKey: "voice-realtime-ai", formatKey: "talk", level: "Advanced",
    tagKeys: ["tag-voice"], participants: [speaker("kenji-watari")], status: "accepted", createdOffsetDays: -28,
  },
  {
    key: "sales-agent-aes-trust", title: "Building a Sales Agent That Your AEs Actually Trust",
    descriptionHtml: "<p>Why adoption, not accuracy, was the hard part of shipping an internal sales agent.</p>",
    formKey: "cfp", trackKey: "agentic-engineering", formatKey: "talk", level: "Intermediate",
    participants: [speaker("grace-odumosu"), coSpeaker("owen-fairweather")], status: "pending", createdOffsetDays: -27,
  },
  {
    key: "notebook-to-fleet", title: "From Notebook to Fleet: Posttraining Pipelines That Scale",
    descriptionHtml: "<p>Turning a one-off fine-tuning notebook into a pipeline the whole team can run unsupervised.</p>",
    formKey: "cfp", trackKey: "agentic-engineering", formatKey: "talk", level: "Advanced",
    participants: [speaker("tomas-reyes")], status: "accept_queue", createdOffsetDays: -26,
  },
  {
    key: "robotics-world-models", title: "Robotics + LLMs: Grounding World Models in Physical Feedback",
    descriptionHtml: "<p>Where LLM planning stops being useful without a classical controller underneath it.</p>",
    formKey: "cfp", trackKey: "robotics-world-models", formatKey: "talk", level: "Advanced",
    tagKeys: ["tag-robotics"], participants: [speaker("mira-papadakis"), coSpeaker("naledi-mokoena")], status: "accepted", createdOffsetDays: -25,
  },
  {
    key: "agentic-commerce-cart", title: "Agentic Commerce: Letting Agents Hold the Cart",
    descriptionHtml: "<p>What actually changes, technically and legally, when an agent is allowed to spend the customer’s money.</p>",
    formKey: "cfp", trackKey: "agentic-commerce", formatKey: "talk", level: "Intermediate",
    participants: [speaker("owen-fairweather")], status: "pending", createdOffsetDays: -24,
  },
  {
    key: "ai-in-healthcare-evals", title: "AI in Healthcare: Getting an Eval Suite Past Your Compliance Team",
    descriptionHtml: "<p>The eval suite that satisfies a clinical reviewer looks nothing like the one that satisfies an ML reviewer.</p>",
    formKey: "cfp", trackKey: "evals", formatKey: "talk", level: "Intermediate",
    tagKeys: ["tag-evals", "tag-enterprise"], participants: [speaker("elena-torkelson")], status: "accepted", createdOffsetDays: -23,
  },
  {
    key: "great-ai-debate", title: "The Great AI Debate: Are Agent Frameworks Already Obsolete?",
    descriptionHtml: "<p>Oxford-style, four speakers, one proposition: the framework layer is already dead weight.</p>",
    formKey: "cfp", trackKey: "agentic-engineering", formatKey: "debate", level: "Intermediate",
    participants: [speaker("priya-kalburgi", "moderator"), panelist("victor-achebe"), panelist("naledi-mokoena"), panelist("claire-bijlsma")],
    status: "accepted", createdOffsetDays: -22,
  },
  {
    key: "security-red-teaming", title: "Security Red-Teaming for Autonomous Coding Agents",
    descriptionHtml: "<p>The red-team playbook for an agent that can open a pull request nobody reviewed closely enough.</p>",
    formKey: "cfp", trackKey: "security", formatKey: "talk", level: "Advanced",
    tagKeys: ["tag-security"], participants: [speaker("victor-achebe")], status: "accepted", createdOffsetDays: -21,
  },
  {
    key: "workshop-retrieval-stack", title: "Workshop: Building a Retrieval Stack From Scratch in 90 Minutes",
    descriptionHtml: "<p>Chunking, embeddings, reranking and evaluation — every layer, hands-on, in one session.</p>",
    formKey: "cfp", trackKey: "mcp", formatKey: "workshop", level: "Beginner",
    participants: [speaker("marcus-iyer"), coSpeaker("devraj-anand")], status: "accepted", createdOffsetDays: -20,
    workshopDurationAnswer: "90 minutes",
  },
  {
    key: "lightning-gpu-cost-cuts", title: "Lightning Talk: Three GPU Cost Cuts We Shipped This Quarter",
    descriptionHtml: "<p>Batching, speculative decoding, and one embarrassing autoscaler bug — eight minutes, three wins.</p>",
    formKey: "cfp", trackKey: "agentic-engineering", formatKey: "lightning", level: "Intermediate",
    participants: [speaker("yuki-tanabe")], status: "accepted", createdOffsetDays: -19,
  },
  {
    key: "ai-architects-build-vs-buy", title: "AI Architects Panel: Build vs. Buy for the Agent Platform Layer",
    descriptionHtml: "<p>A CTO and a PM disagree, on stage, about whether the platform layer is worth owning.</p>",
    formKey: "cfp", trackKey: "agentic-engineering", formatKey: "panel", level: "Intermediate",
    participants: [speaker("claire-bijlsma"), coSpeaker("owen-fairweather")], status: "decline_queue", createdOffsetDays: -18,
  },
  {
    key: "local-first-agents", title: "Local-First Agents: Running Frontier-ish Models on a Laptop",
    descriptionHtml: "<p>How close a laptop-sized open-weight model gets to a frontier API, and where the gap still hurts.</p>",
    formKey: "cfp", trackKey: "agentic-engineering", formatKey: "talk", level: "Beginner",
    tagKeys: ["tag-open-source"], participants: [speaker("renata-souza")], status: "withdrawn", createdOffsetDays: -17,
  },
  {
    key: "data-quality-reliability", title: "Data Quality Is an Agent Reliability Problem in Disguise",
    descriptionHtml: "<p>Most of the \"agent reliability\" incidents we’ve debugged were actually data quality incidents.</p>",
    formKey: "cfp", trackKey: "agentic-engineering", formatKey: "talk", level: "Intermediate",
    participants: [speaker("naledi-mokoena")], status: "declined", createdOffsetDays: -16,
  },
  {
    key: "mcp-servers-near-duplicate", title: "Shipping MCP Servers to Prod Without Regretting It",
    descriptionHtml: "<p>The same lesson a lot of teams are learning independently right now, from the fintech side of it.</p>",
    formKey: "cfp", trackKey: "mcp", formatKey: "talk", level: "Advanced",
    participants: [speaker("owen-fairweather")], status: "pending", createdOffsetDays: -15,
  },
  {
    key: "vellumatic-vendor-pitch", title: "How Vellumatic Solves Agent Reliability",
    descriptionHtml: "<p>An overview of the Vellumatic platform and why it is the right choice for agent reliability.</p>",
    formKey: "cfp", trackKey: "mcp", formatKey: "talk", level: "Intermediate",
    participants: [speaker("renata-souza")], status: "pending", createdOffsetDays: -14,
  },
  {
    key: "draft-priya-untitled", title: "Untitled — routing at scale (working title)",
    descriptionHtml: "<p>Notes so far: agentic routing, forecasting, a logistics company nobody expects to be an AI shop.</p>",
    formKey: "cfp", trackKey: "agentic-engineering", formatKey: "talk",
    participants: [speaker("priya-kalburgi")], status: "draft", createdOffsetDays: -5,
  },
  {
    key: "draft-dana-untitled", title: "Draft: Northline’s internal agent platform, one year in",
    descriptionHtml: "<p>Still outlining. Want to cover the incident that made us rebuild the tool-calling layer.</p>",
    formKey: "cfp", trackKey: "agentic-engineering", formatKey: "talk",
    participants: [speaker("dana-whitfield")], status: "draft", createdOffsetDays: -2,
  },
] as const;

// ---------------------------------------------------------------------------
// Agenda: the 20 sessions, three days, two planted conflicts
// ---------------------------------------------------------------------------

export type DemoSessionPlacement = { dayOffset: 65 | 66 | 67; start: string; end: string; roomKey: string };

export type DemoSession = {
  key: string;
  title: string;
  descriptionHtml: string;
  trackKey: string;
  formatKey: string;
  speakerKeys: readonly string[];
  /** `null` means the session sits unscheduled, in the tray. */
  placement: DemoSessionPlacement | null;
};

/**
 * Twenty sessions, `published: false` throughout provisioning (design
 * §2.4). The research doc's twenty invented titles (§4) are used verbatim
 * and exactly once each — the same twenty that appear as accepted
 * `SUBMISSIONS` above, now placed on the grid.
 *
 * Two conflicts are planted, and neither carries scaffolding in its name
 * (`⚠ Demo conflict …` stays in `scripts/seed` — a demo-event visitor must
 * never be handed the answer before they find it):
 *
 * 1. **Room double-booking.** "Context Engineering Is the New Prompt
 *    Engineering" and "Evals as a Product Requirement, Not an Afterthought"
 *    both land Main Stage, day 1, 10:15.
 * 2. **Same-speaker double-booking.** Priya Kalburgi is scheduled in
 *    Embarcadero and on the Expo Stage at 14:00 on the same day.
 *
 * **Two, and only two.** `detectConflicts` judges three subjects, not two:
 * a pair sharing a *track* at the same minute is a `warning`, and the badge,
 * the toolbar banner and the tour's own `conflictCount` all count warnings
 * alongside errors. So a same-track overlap is as visible to the organizer as
 * a double-booked room, and the cold open, the start fork and the provisioning
 * narration all promise them exactly two. That is why `sales-agent-aes-trust`
 * sits in Agentic Engineering rather than beside the cart talk it doubles Priya
 * with, why `graphrag-50m-nodes` is Context Engineering rather than MCP, and
 * why the lightning talk starts at 15:20 rather than 15:00. `dataset.test.ts`
 * asserts the real detector's total, not a room-and-speaker subset.
 *
 * One back-to-back pair — Embarcadero 11:00–11:18 immediately followed by
 * 11:18–11:36 — touches but never overlaps, and must never be flagged: an
 * engine that reddens a normal back-to-back programme is one organizers
 * stop trusting.
 *
 * Three sessions are left with `placement: null`, accepted but unscheduled,
 * sitting in the agenda's tray — and **one of the three is load-bearing**:
 * `SET_PIECE_TRAY_SESSION_KEY` below is the talk Chapter 7 tells the organizer
 * to place, so it has to start the tour in the tray or the step can never
 * fire. See that constant for the whole rule.
 */
export const SESSIONS: readonly DemoSession[] = [
  {
    key: "opening-keynote", title: "Keynote: The Agentic Engineering Stack, One Year Later",
    descriptionHtml: "<p>A year of shipped agent platforms, reviewed honestly: what the hype got right, what quietly died.</p>",
    trackKey: "agentic-engineering", formatKey: "keynote", speakerKeys: ["bastian-kroll"],
    placement: { dayOffset: 65, start: "09:00", end: "09:40", roomKey: "main-stage" },
  },
  // Conflict 1, member A — room double-booking.
  {
    key: "context-engineering", title: "Context Engineering Is the New Prompt Engineering",
    descriptionHtml: "<p>Why the hard problem moved from wording the prompt to curating everything around it.</p>",
    trackKey: "context-engineering", formatKey: "talk", speakerKeys: ["sam-odoyle"],
    placement: { dayOffset: 65, start: "10:15", end: "10:33", roomKey: "main-stage" },
  },
  // Conflict 1, member B — same room, same start time as the session above.
  {
    key: "evals-product-requirement", title: "Evals as a Product Requirement, Not an Afterthought",
    descriptionHtml: "<p>Treating an eval suite as a shipped deliverable instead of a research side project.</p>",
    trackKey: "evals", formatKey: "talk", speakerKeys: ["aisha-bello"],
    placement: { dayOffset: 65, start: "10:15", end: "10:33", roomKey: "main-stage" },
  },
  // The must-not-flag back-to-back pair, member A.
  //
  // This slot used to hold `voice-agents-300ms`, which is the one talk
  // Chapter 7 asks the organizer to place — a session cannot both already be
  // on the grid and be placed from the tray, and the step deadlocked on
  // exactly that. Robotics moved up from the tray to keep the pair, and the
  // talk the script names moved down into it.
  {
    key: "robotics-world-models", title: "Robotics + LLMs: Grounding World Models in Physical Feedback",
    descriptionHtml: "<p>Where LLM planning stops being useful without a classical controller underneath it.</p>",
    trackKey: "robotics-world-models", formatKey: "talk", speakerKeys: ["mira-papadakis", "naledi-mokoena"],
    placement: { dayOffset: 65, start: "11:00", end: "11:18", roomKey: "embarcadero" },
  },
  // The must-not-flag back-to-back pair, member B — starts exactly when the
  // session above ends, in the same room. Touching, not overlapping.
  {
    key: "shipping-mcp-servers", title: "Shipping MCP Servers Into Production Without Regretting It",
    descriptionHtml: "<p>The operational lessons that only show up once real traffic hits an MCP server.</p>",
    trackKey: "mcp", formatKey: "talk", speakerKeys: ["marcus-iyer"],
    placement: { dayOffset: 65, start: "11:18", end: "11:36", roomKey: "embarcadero" },
  },
  {
    key: "security-red-teaming", title: "Security Red-Teaming for Autonomous Coding Agents",
    descriptionHtml: "<p>The red-team playbook for an agent that can open a pull request nobody reviewed closely enough.</p>",
    trackKey: "security", formatKey: "talk", speakerKeys: ["victor-achebe"],
    placement: { dayOffset: 65, start: "11:00", end: "11:18", roomKey: "mission-room" },
  },
  // Conflict 2, member A — Priya Kalburgi, Embarcadero, 14:00.
  {
    key: "sales-agent-aes-trust", title: "Building a Sales Agent That Your AEs Actually Trust",
    descriptionHtml: "<p>Why adoption, not accuracy, was the hard part of shipping an internal sales agent.</p>",
    trackKey: "agentic-engineering", formatKey: "talk", speakerKeys: ["priya-kalburgi"],
    placement: { dayOffset: 65, start: "14:00", end: "14:18", roomKey: "embarcadero" },
  },
  // Conflict 2, member B — Priya Kalburgi again, Expo Stage, the same 14:00.
  {
    key: "agentic-commerce-cart", title: "Agentic Commerce: Letting Agents Hold the Cart",
    descriptionHtml: "<p>What actually changes, technically and legally, when an agent is allowed to spend the customer’s money.</p>",
    trackKey: "agentic-commerce", formatKey: "talk", speakerKeys: ["priya-kalburgi"],
    placement: { dayOffset: 65, start: "14:00", end: "14:18", roomKey: "expo-stage" },
  },
  {
    key: "lightning-gpu-cost-cuts", title: "Lightning Talk: Three GPU Cost Cuts We Shipped This Quarter",
    descriptionHtml: "<p>Batching, speculative decoding, and one embarrassing autoscaler bug — eight minutes, three wins.</p>",
    trackKey: "agentic-engineering", formatKey: "lightning", speakerKeys: ["yuki-tanabe"],
    placement: { dayOffset: 65, start: "15:20", end: "15:28", roomKey: "expo-stage" },
  },
  {
    key: "reasoning-rl", title: "Reasoning Models in the Loop: When RL Post-Training Actually Pays Off",
    descriptionHtml: "<p>Where GRPO-style post-training earned its compute budget, and where it quietly didn’t.</p>",
    trackKey: "agentic-engineering", formatKey: "talk", speakerKeys: ["tomas-reyes"],
    placement: { dayOffset: 65, start: "15:00", end: "15:18", roomKey: "mission-room" },
  },
  {
    key: "ai-architects-build-vs-buy", title: "AI Architects Panel: Build vs. Buy for the Agent Platform Layer",
    descriptionHtml: "<p>A CTO and a PM disagree, on stage, about whether the platform layer is worth owning.</p>",
    trackKey: "agentic-engineering", formatKey: "panel", speakerKeys: ["claire-bijlsma", "owen-fairweather"],
    placement: { dayOffset: 66, start: "09:00", end: "09:45", roomKey: "main-stage" },
  },
  {
    key: "workshop-retrieval-stack", title: "Workshop: Building a Retrieval Stack From Scratch in 90 Minutes",
    descriptionHtml: "<p>Chunking, embeddings, reranking and evaluation — every layer, hands-on, in one session.</p>",
    trackKey: "mcp", formatKey: "workshop", speakerKeys: ["marcus-iyer"],
    placement: { dayOffset: 66, start: "10:00", end: "11:30", roomKey: "workshop-studio-a" },
  },
  {
    key: "computer-use-agents", title: "Computer-Use Agents That Don’t Fall Over on Real Websites",
    descriptionHtml: "<p>The failure modes that only show up once an agent leaves a curated demo environment.</p>",
    trackKey: "agentic-engineering", formatKey: "talk", speakerKeys: ["claire-bijlsma", "priya-kalburgi"],
    placement: { dayOffset: 66, start: "10:00", end: "10:18", roomKey: "mission-room" },
  },
  {
    key: "graphrag-50m-nodes", title: "GraphRAG at 50M Nodes: Lessons From a Real Enterprise Rollout",
    descriptionHtml: "<p>Scaling a knowledge-graph-backed retrieval system past the point where demos usually stop.</p>",
    trackKey: "context-engineering", formatKey: "talk", speakerKeys: ["devraj-anand"],
    placement: { dayOffset: 66, start: "10:00", end: "10:18", roomKey: "embarcadero" },
  },
  {
    key: "notebook-to-fleet", title: "From Notebook to Fleet: Posttraining Pipelines That Scale",
    descriptionHtml: "<p>Turning a one-off fine-tuning notebook into a pipeline the whole team can run unsupervised.</p>",
    trackKey: "agentic-engineering", formatKey: "talk", speakerKeys: ["tomas-reyes"],
    placement: { dayOffset: 66, start: "11:00", end: "11:18", roomKey: "mission-room" },
  },
  {
    key: "great-ai-debate", title: "The Great AI Debate: Are Agent Frameworks Already Obsolete?",
    descriptionHtml: "<p>Oxford-style, four speakers, one proposition: the framework layer is already dead weight.</p>",
    trackKey: "agentic-engineering", formatKey: "debate",
    speakerKeys: ["priya-kalburgi", "victor-achebe", "naledi-mokoena", "claire-bijlsma"],
    placement: { dayOffset: 66, start: "13:00", end: "13:45", roomKey: "main-stage" },
  },
  {
    key: "local-first-agents", title: "Local-First Agents: Running Frontier-ish Models on a Laptop",
    descriptionHtml: "<p>How close a laptop-sized open-weight model gets to a frontier API, and where the gap still hurts.</p>",
    trackKey: "agentic-engineering", formatKey: "talk", speakerKeys: ["renata-souza"],
    placement: { dayOffset: 66, start: "14:00", end: "14:18", roomKey: "embarcadero" },
  },
  // Accepted, but never placed — the tray needs real content, not an empty state.
  //
  // Chapter 7's set-piece: the organizer opens this one from the tray and
  // gives it Main Stage at 10:15 on day one, where two talks already are.
  // `SET_PIECE_TRAY_SESSION_KEY` names it and `dataset.test.ts` holds it here.
  {
    key: "voice-agents-300ms", title: "Voice Agents Under 300ms: An Infra Deep Dive",
    descriptionHtml: "<p>The latency budget breakdown behind a voice agent that feels like a phone call, not a chatbot.</p>",
    trackKey: "voice-realtime-ai", formatKey: "talk", speakerKeys: ["kenji-watari"],
    placement: null,
  },
  {
    key: "ai-in-healthcare-evals", title: "AI in Healthcare: Getting an Eval Suite Past Your Compliance Team",
    descriptionHtml: "<p>The eval suite that satisfies a clinical reviewer looks nothing like the one that satisfies an ML reviewer.</p>",
    trackKey: "evals", formatKey: "talk", speakerKeys: ["elena-torkelson"],
    placement: null,
  },
  {
    key: "data-quality-reliability", title: "Data Quality Is an Agent Reliability Problem in Disguise",
    descriptionHtml: "<p>Most of the \"agent reliability\" incidents we’ve debugged were actually data quality incidents.</p>",
    trackKey: "agentic-engineering", formatKey: "talk", speakerKeys: ["naledi-mokoena"],
    placement: null,
  },
] as const;

/**
 * Chapter 7's set-piece, in data.
 *
 * The tour tells the organizer, by name, to take one talk out of the tray and
 * drop it on a slot two other talks already own: the conflict badge moves
 * because *they* caused it, and the next step is them fixing it. The step is
 * armed on `sessionsScheduled` increasing, so the whole chapter rests on one
 * fact this file owns — **the session the script names starts unscheduled.**
 *
 * It did not, once. Provisioning had this talk on the grid at 11:00 as one
 * half of the must-not-flag back-to-back pair, so the tray never held it, the
 * count never moved, and the step waited out its ten-minute yield in front of
 * an organizer who had followed the instruction exactly. Neither half's unit
 * tests could see it: the script was internally valid, the dataset's conflict
 * geometry was correct, and only the join between them was wrong.
 *
 * So the join is named here and asserted from both ends — `dataset.test.ts`
 * pins the placement to `null` and proves the target slot is already occupied,
 * `tour/script.test.ts` pins the copy to this session and this slot, and
 * `tests/integration/demo-tour-golden-path.test.ts` drives the step against a
 * really provisioned demo, from the tray, onto this slot.
 */
export const SET_PIECE_TRAY_SESSION_KEY = "voice-agents-300ms";

/** The slot Chapter 7's copy names. Occupied on purpose — that is the trap. */
export const SET_PIECE_TARGET_SLOT: DemoSessionPlacement = {
  dayOffset: 65, start: "10:15", end: "10:33", roomKey: "main-stage",
};

// ---------------------------------------------------------------------------
// Portal: task definitions, assignments, one file request
// ---------------------------------------------------------------------------

export type DemoTaskDefinition = {
  key: string;
  name: string;
  descriptionHtml: string;
  completionMode: "manual" | "form" | "file_request";
  dueOffsetDays: number;
  createdOffsetDays: number;
};

/** `travel-form` is the one deliberately overdue task (design §2.4): due 30
 *  days ago, created 45 days ago, so it is temporally coherent *and* every
 *  rung of the reminder ladder has already had a chance to fire. */
export const TASK_DEFINITIONS: readonly DemoTaskDefinition[] = [
  {
    key: "headshot", name: "Upload a headshot",
    descriptionHtml: "<p>A recent, well-lit photo for the speaker gallery and signage.</p>",
    completionMode: "file_request", dueOffsetDays: 15, createdOffsetDays: -20,
  },
  {
    key: "bio", name: "Write your speaker bio",
    descriptionHtml: "<p>Write it on your Profile page — two or three sentences for the program and the public speaker page.</p>",
    completionMode: "manual", dueOffsetDays: 10, createdOffsetDays: -20,
  },
  {
    key: "slides", name: "Upload your slide deck",
    descriptionHtml: "<p>PDF or Keynote, 16:9. A backup PDF is required even if you present from your own laptop.</p>",
    completionMode: "file_request", dueOffsetDays: 40, createdOffsetDays: -18,
  },
  {
    key: "travel-form", name: "Submit your travel form",
    descriptionHtml: "<p>Flight and hotel preferences, so the team can book before fares climb.</p>",
    completionMode: "form", dueOffsetDays: -30, createdOffsetDays: -45,
  },
] as const;

export type DemoTaskAssignment = { taskKey: string; speakerKey: string };

/**
 * Chapter 6's protagonist: the one accepted speaker left holding an overdue
 * assignment after phase 8 marks everybody else's done.
 *
 * It lives here, in pure data, rather than in the phase that uses it, because
 * the tour *script* names this person in four strings and the two must never
 * drift: a chapter that sends the organizer to impersonate a speaker with an
 * empty task list dead-ends on an objective the world can never satisfy.
 * `script.test.ts` pins the pair. Dana Whitfield cannot be it — her only
 * submission is a draft, so `accepted_speakers_v` never materialises an
 * assignment for her at all.
 */
export const OVERDUE_HOLDOUT_SPEAKER_KEY = "victor-achebe";

/** Nine speakers, each with exactly one assignment — including the overdue
 *  holdout above on the `travel-form` task, the reason the reminder ladder has
 *  something real to show in Chapter 6. */
export const TASK_ASSIGNMENTS: readonly DemoTaskAssignment[] = [
  { taskKey: "headshot", speakerKey: "elena-torkelson" },
  { taskKey: "headshot", speakerKey: "kenji-watari" },
  { taskKey: "bio", speakerKey: "marcus-iyer" },
  { taskKey: "bio", speakerKey: "priya-kalburgi" },
  { taskKey: "slides", speakerKey: "tomas-reyes" },
  { taskKey: "slides", speakerKey: "yuki-tanabe" },
  { taskKey: "travel-form", speakerKey: "dana-whitfield" },
  { taskKey: "travel-form", speakerKey: "victor-achebe" },
  { taskKey: "travel-form", speakerKey: "naledi-mokoena" },
] as const;

export type DemoFileRequest = {
  key: string;
  taskKey: string;
  title: string;
  instructionsHtml: string;
  acceptedExtensions: readonly string[];
  maxSizeMb: number;
};

export const FILE_REQUESTS: readonly DemoFileRequest[] = [
  {
    key: "slides-request", taskKey: "slides", title: "Final slide deck",
    instructionsHtml: "<p>PDF or Keynote, 16:9. Upload a backup PDF even if you present from your own laptop.</p>",
    acceptedExtensions: ["pdf", "key", "pptx"], maxSizeMb: 100,
  },
] as const;

// ---------------------------------------------------------------------------
// Resources: 3 pages, one unpublished
// ---------------------------------------------------------------------------

export type DemoResourcePage = {
  key: string;
  title: string;
  slug: string;
  summary: string;
  bodyHtml: string;
  published: boolean;
};

export const RESOURCE_PAGES: readonly DemoResourcePage[] = [
  {
    key: "speaker-handbook", title: "Speaker handbook", slug: "speaker-handbook",
    summary: "Arrival, check-in, stage logistics and what to expect from the production team.",
    bodyHtml: "<h2>Welcome</h2><p>Check in at the Speaker Lounge at least 45 minutes before your session. AV runs a tech check the day before for anyone presenting a live demo.</p>",
    published: true,
  },
  {
    key: "travel-reimbursement", title: "Travel & reimbursement", slug: "travel-reimbursement",
    summary: "Flights, hotel nights covered, and how to file for reimbursement afterward.",
    bodyHtml: "<h2>What’s covered</h2><p>Economy flights, with a Bay-Area-local exception. Two nights domestic, three nights international. Submit receipts through the travel form within 30 days.</p>",
    published: true,
  },
  {
    key: "recording-release", title: "Recording release", slug: "recording-release",
    summary: "The consent terms for the professionally recorded session video, still being finalized.",
    bodyHtml: "<h2>Draft — not yet published</h2><p>Sessions are recorded for YouTube, X and LinkedIn distribution. This page will carry the final release terms before the CFP closes.</p>",
    published: false,
  },
] as const;

// ---------------------------------------------------------------------------
// Communications: 9 backdated, always-skipped log rows
// ---------------------------------------------------------------------------

export type DemoCommLogRow = {
  key: string;
  templateKey: TemplateKey;
  speakerKey: string;
  subjectRendered: string;
  /** Relative to `now`. Always within [-14, 0] — see `demoDates(now).comms`.
   *  Mutually exclusive with `hoursAgo`; every row sets exactly one. */
  offsetDays?: number;
  /** Only the most recent row uses this instead of `offsetDays`, matching
   *  design §2.4's "−1 h" endpoint of the backdated window. */
  hoursAgo?: number;
};

/**
 * Nine rows of history, every one of them `skipped`.
 *
 * There is deliberately **no** `status` field to set. Six of these rows used
 * to be seeded `sent` and one `failed`, to make the log look lived-in; the
 * addresses were `.demo.invalid` so nothing was ever delivered, but the column
 * an organizer actually reads said otherwise, and MTP-18 §4/26 — the safety
 * audit, pass/fail — requires every row on a demo event's delivery log to read
 * `Skipped`. A status the dataset cannot express is a status provisioning
 * cannot get wrong. The history is still here: nine backdated rows, real
 * templates, real recipients, real subjects, spread across two weeks. Only the
 * claim to have dispatched mail is gone.
 *
 * Never `queued` either (design §2.4: a demo event provisions its
 * communications history directly, it never enqueues a row for the live
 * dispatcher to pick up).
 */
export const COMM_LOG_ROWS: readonly DemoCommLogRow[] = [
  {
    key: "submission-received-marcus", templateKey: "submission_received", speakerKey: "marcus-iyer",
    subjectRendered: "We received your submission: Shipping MCP Servers Into Production Without Regretting It",
    offsetDays: -14,
  },
  {
    key: "submission-received-aisha", templateKey: "submission_received", speakerKey: "aisha-bello",
    subjectRendered: "We received your submission: Evals as a Product Requirement, Not an Afterthought",
    offsetDays: -12,
  },
  {
    key: "submission-accepted-tomas", templateKey: "submission_accepted", speakerKey: "tomas-reyes",
    subjectRendered: "You’re in! Reasoning Models in the Loop: When RL Post-Training Actually Pays Off",
    offsetDays: -10,
  },
  // Victor Achebe, not Dana Whitfield: he is the one speaker whose travel form
  // is genuinely still outstanding (see `OVERDUE_HOLDOUT_KEY` in phase 8 —
  // Dana's only submission is a draft, so she can never hold an assignment at
  // all), and Chapter 6 sends the organizer to read exactly this ladder.
  {
    key: "task-assigned-victor", templateKey: "task_assigned", speakerKey: "victor-achebe",
    subjectRendered: "New task: Submit your travel form", offsetDays: -9,
  },
  {
    key: "schedule-assigned-priya", templateKey: "schedule_assigned", speakerKey: "priya-kalburgi",
    subjectRendered: "Your session is scheduled: Building a Sales Agent That Your AEs Actually Trust",
    offsetDays: -6,
  },
  {
    key: "task-reminder-victor", templateKey: "task_reminder", speakerKey: "victor-achebe",
    subjectRendered: "Reminder: Submit your travel form", offsetDays: -2,
  },
  {
    key: "portal-login-elena", templateKey: "portal_login", speakerKey: "elena-torkelson",
    subjectRendered: "Your speaker portal link", offsetDays: -5,
  },
  {
    key: "review-reminder-victor", templateKey: "review_reminder", speakerKey: "victor-achebe",
    subjectRendered: "Reviews are waiting for you", offsetDays: -3,
  },
  {
    key: "task-reminder-yuki", templateKey: "task_reminder", speakerKey: "yuki-tanabe",
    subjectRendered: "Reminder: Upload your slide deck", hoursAgo: 1,
  },
] as const;

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/**
 * Expected per-table row counts, asserted by both `dataset.test.ts` (against
 * this module's own arrays) and the integration suite (against what
 * actually landed in the database). A drift between the two is exactly the
 * bug class this constant exists to catch.
 */
export const DATASET_MANIFEST = {
  tracks: TRACKS.length,
  rooms: ROOMS.length,
  formats: FORMATS.length,
  tags: TAGS.length,
  speakers: SPEAKERS.length,
  forms: FORMS.length,
  formFields: FORMS.reduce((total, form) => total + form.fields.length, 0),
  routingRules: ROUTING_RULES.length,
  submissions: SUBMISSIONS.length,
  sessions: SESSIONS.length,
  taskDefinitions: TASK_DEFINITIONS.length,
  taskAssignments: TASK_ASSIGNMENTS.length,
  fileRequests: FILE_REQUESTS.length,
  resourcePages: RESOURCE_PAGES.length,
  communicationLogs: COMM_LOG_ROWS.length,
} as const;
