import type { DemoState, ReviewRecord, SpeakerRecord, SubmissionRecord } from "./types";

export const DEMO_EVENT_ID = "evt_ai_engineer_2026";
export const DEMO_EVENT_SLUG = "ai-engineer";
export const DEMO_FORM_ID = "technical-talks";
export const DEMO_SPEAKER_ID = "spk_nadia";

const speakers: SpeakerRecord[] = [
  { id: "spk_nadia", eventId: DEMO_EVENT_ID, firstName: "Nadia", lastName: "Rahman", email: "nadia@vectorlab.ai", company: "VectorLab", title: "VP of AI", bio: "Nadia builds reliable AI systems for high-stakes environments. She leads applied research at VectorLab and is a frequent speaker on evaluation, observability, and human-centered AI.", location: "New York, NY", website: "https://vectorlab.ai", linkedin: "linkedin.com/in/nadiarahman", avatar: "NR", avatarColor: "#6958d7", confirmation: "confirmed", profileCompletion: 100, tags: ["Keynote", "AI systems"] },
  { id: "spk_alex", eventId: DEMO_EVENT_ID, firstName: "Alex", lastName: "Chen", email: "alex@latent.space", company: "Latent Space", title: "Founder", bio: "Alex explores the intersection of developer tools and foundation models.", location: "San Francisco, CA", website: "https://latent.space", linkedin: "linkedin.com/in/alexchen", avatar: "AC", avatarColor: "#2d8d79", confirmation: "confirmed", profileCompletion: 92, tags: ["Agents"] },
  { id: "spk_priya", eventId: DEMO_EVENT_ID, firstName: "Priya", lastName: "Shah", email: "priya@modelworks.com", company: "Modelworks", title: "Staff Engineer", bio: "Priya works on training infrastructure and model serving at global scale.", location: "Seattle, WA", website: "", linkedin: "linkedin.com/in/priyashah", avatar: "PS", avatarColor: "#db715a", confirmation: "confirmed", profileCompletion: 84, tags: ["Infrastructure"] },
  { id: "spk_marcus", eventId: DEMO_EVENT_ID, firstName: "Marcus", lastName: "Thompson", email: "marcus@northstar.dev", company: "Northstar", title: "CTO", bio: "Marcus is building the developer platform for the agentic era.", location: "Austin, TX", website: "https://northstar.dev", linkedin: "", avatar: "MT", avatarColor: "#2672a8", confirmation: "unconfirmed", profileCompletion: 64, tags: ["Developer tools"] },
  { id: "spk_elena", eventId: DEMO_EVENT_ID, firstName: "Elena", lastName: "Vasquez", email: "elena@openmodel.org", company: "Open Model Initiative", title: "Research Lead", bio: "Elena researches efficient open-weight language models.", location: "Madrid, Spain", website: "https://openmodel.org", linkedin: "linkedin.com/in/elenav", avatar: "EV", avatarColor: "#ad5d92", confirmation: "confirmed", profileCompletion: 100, tags: ["Open source"] },
  { id: "spk_jamal", eventId: DEMO_EVENT_ID, firstName: "Jamal", lastName: "Okafor", email: "jamal@guardrail.ai", company: "Guardrail", title: "CEO", bio: "Jamal works at the frontier of AI security and policy.", location: "London, UK", website: "https://guardrail.ai", linkedin: "linkedin.com/in/jamalokafor", avatar: "JO", avatarColor: "#b9832f", confirmation: "confirmed", profileCompletion: 96, tags: ["Safety"] },
  { id: "spk_sophia", eventId: DEMO_EVENT_ID, firstName: "Sophia", lastName: "Kim", email: "sophia@canvas.ai", company: "Canvas AI", title: "Head of Product", bio: "Sophia turns frontier models into products that people love.", location: "Los Angeles, CA", website: "https://canvas.ai", linkedin: "", avatar: "SK", avatarColor: "#3c8b96", confirmation: "confirmed", profileCompletion: 78, tags: ["Product"] },
  { id: "spk_luis", eventId: DEMO_EVENT_ID, firstName: "Luis", lastName: "Ortega", email: "luis@compute.io", company: "Compute.io", title: "Principal Engineer", bio: "Luis designs inference systems that are fast, efficient, and observable.", location: "Mexico City, Mexico", website: "", linkedin: "linkedin.com/in/luisortega", avatar: "LO", avatarColor: "#6f7fa9", confirmation: "confirmed", profileCompletion: 88, tags: ["Infrastructure"] },
  { id: "spk_mina", eventId: DEMO_EVENT_ID, firstName: "Mina", lastName: "Park", email: "mina@redwood.ai", company: "Redwood AI", title: "Research Scientist", bio: "Mina studies long-context reasoning and memory for autonomous agents.", location: "Toronto, Canada", website: "https://minapark.dev", linkedin: "", avatar: "MP", avatarColor: "#4d9078", confirmation: "unconfirmed", profileCompletion: 56, tags: ["Research"] },
  { id: "spk_theo", eventId: DEMO_EVENT_ID, firstName: "Theo", lastName: "Martin", email: "theo@craft.dev", company: "Craft", title: "Design Engineer", bio: "Theo prototypes new ways for humans to collaborate with AI.", location: "Paris, France", website: "https://theomartin.design", linkedin: "", avatar: "TM", avatarColor: "#b35f65", confirmation: "confirmed", profileCompletion: 100, tags: ["Design"] },
  { id: "spk_aisha", eventId: DEMO_EVENT_ID, firstName: "Aisha", lastName: "Bello", email: "aisha@signal.bio", company: "Signal Bio", title: "ML Director", bio: "Aisha leads scientific AI programs for drug discovery.", location: "Boston, MA", website: "", linkedin: "linkedin.com/in/aishabello", avatar: "AB", avatarColor: "#8c6bb1", confirmation: "confirmed", profileCompletion: 72, tags: ["Applied AI"] },
  { id: "spk_owen", eventId: DEMO_EVENT_ID, firstName: "Owen", lastName: "Brooks", email: "owen@relay.systems", company: "Relay Systems", title: "Co-founder", bio: "Owen builds multi-agent coordination infrastructure.", location: "Chicago, IL", website: "https://relay.systems", linkedin: "", avatar: "OB", avatarColor: "#347d87", confirmation: "declined", profileCompletion: 81, tags: ["Agents"] },
];

const submissionSeed: Array<[string, string, string, string, string, string]> = [
  ["sub_101", "SESS-101", "spk_nadia", "From Prototype to Production: Evaluating Agentic Systems", "AI Agents", "Talk · 30 min"],
  ["sub_102", "SESS-102", "spk_alex", "The New AI Engineer Stack", "Developer Tools", "Keynote · 45 min"],
  ["sub_103", "SESS-103", "spk_priya", "Serving a Billion Tokens Before Lunch", "Infrastructure", "Talk · 30 min"],
  ["sub_104", "SESS-104", "spk_marcus", "Interfaces for Autonomous Software", "Developer Tools", "Talk · 30 min"],
  ["sub_105", "SESS-105", "spk_elena", "Small Models, Serious Capability", "Models & Research", "Talk · 30 min"],
  ["sub_106", "SESS-106", "spk_jamal", "Red Teaming Agents in the Wild", "Safety", "Workshop · 60 min"],
  ["sub_107", "SESS-107", "spk_sophia", "Designing AI Products People Trust", "Product", "Talk · 30 min"],
  ["sub_108", "SESS-108", "spk_luis", "The 50ms Inference Stack", "Infrastructure", "Talk · 30 min"],
  ["sub_109", "SESS-109", "spk_mina", "Memory Is the New Context Window", "Models & Research", "Talk · 30 min"],
  ["sub_110", "SESS-110", "spk_theo", "The Shape of Human–AI Collaboration", "Design", "Talk · 30 min"],
  ["sub_111", "SESS-111", "spk_aisha", "AI That Discovers New Medicines", "Applied AI", "Talk · 30 min"],
  ["sub_112", "SESS-112", "spk_owen", "A Protocol for Multi-Agent Teams", "AI Agents", "Talk · 30 min"],
];

// Seeded reviews are the single source of truth: each submission's score and
// reviewCount are derived from these lists, matching how ADD_REVIEW recomputes.
const reviewScores: Record<string, number[]> = {
  sub_101: [5, 5, 4, 5, 5],
  sub_102: [5, 5, 4, 5, 4],
  sub_103: [5, 4, 4, 5],
  sub_104: [4, 4, 4],
  sub_105: [5, 4, 5, 4],
  sub_106: [4, 5, 4, 4],
  sub_107: [4, 4, 5],
  sub_108: [4, 4, 4, 5],
  sub_110: [5, 5, 4, 5, 4],
  sub_111: [4, 5, 4, 4],
  sub_112: [4, 3],
};

const REVIEWERS = ["Morgan Lee", "Jamie Patel", "Taylor Reed", "Priyanka Rao", "Chris Alvarez"];
const REVIEW_NOTES = [
  "Strong, specific, and deeply useful. Great fit for the audience.",
  "Excellent speaker and a very timely subject.",
  "Would like a little more about failure modes, otherwise strong.",
  "Clear narrative and a compelling set of takeaways.",
  "Solid proposal; the demo plan could be tighter.",
];

const reviews: ReviewRecord[] = Object.entries(reviewScores).flatMap(([submissionId, scores]) =>
  scores.map((score, index) => ({
    id: `rev_${submissionId.slice(4)}_${index + 1}`,
    submissionId,
    reviewer: REVIEWERS[index % REVIEWERS.length] ?? "Program committee",
    score,
    note: REVIEW_NOTES[index % REVIEW_NOTES.length] ?? "Solid proposal.",
    createdAt: `2026-07-${String(8 + index * 2).padStart(2, "0")}T12:00:00.000Z`,
  })),
);

const submissions: SubmissionRecord[] = submissionSeed.map(([id, code, speakerId, title, track, format], index) => {
  const scores = reviewScores[id] ?? [];
  return {
    id, code, eventId: DEMO_EVENT_ID, formId: DEMO_FORM_ID, title, type: format, status: index < 8 ? "accepted" : index < 10 ? "pending" : "accept_queue",
    speakerIds: [speakerId], track, format, tags: index % 2 === 0 ? ["Featured"] : [], submittedAt: `2026-06-${String(index + 3).padStart(2, "0")}T18:30:00.000Z`, updatedAt: "2026-08-07T18:30:00.000Z",
    abstract: "A practical, candid session grounded in lessons from production. Attendees will leave with patterns they can use immediately, tradeoffs to watch for, and a clear framework for deciding what to build next.",
    audience: "AI engineers, technical leaders, and product teams moving generative AI systems from promising demos into dependable products.",
    takeaways: "A repeatable evaluation framework; concrete architecture patterns; and a checklist for avoiding the most expensive mistakes.",
    answers: { title, abstract: "A practical, candid session grounded in lessons from production.", track, experience: index % 3 === 0 ? "Advanced" : "Intermediate", recording: true },
    score: scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    reviewCount: scores.length,
  };
});

export const initialDemoState: DemoState = {
  events: [{ id: DEMO_EVENT_ID, slug: DEMO_EVENT_SLUG, name: "AI Engineer World’s Fair 2026", shortName: "AI Engineer", timezone: "America/Los_Angeles", city: "San Francisco, CA", venue: "Fort Mason Center", startsAt: "2026-09-15T16:00:00.000Z", endsAt: "2026-09-17T01:00:00.000Z", accent: "#6958d7", logoText: "AI.engineer", status: "live" }],
  forms: [{
    id: DEMO_FORM_ID, eventId: DEMO_EVENT_ID, slug: DEMO_FORM_ID, name: "Technical Talks 2026", status: "open", version: 7,
    opensAt: "2026-05-01T16:00:00.000Z", closesAt: "2026-08-31T06:59:00.000Z", submissionLimit: 500, maxPerSpeaker: 3, submissions: 247,
    welcomeTitle: "Share what you’re building with the AI engineering community", welcomeBody: "We’re looking for deeply technical, honest stories from the people shaping what comes next. Tell us what you learned—and what you wish you knew sooner.",
    successTitle: "Your idea is in!", successBody: "We’ve sent a confirmation to your inbox. You can return to your speaker portal any time to review or update your proposal before the call closes.",
    sections: [
      { id: "sec_session", title: "Your session", description: "Tell the review committee what you want to share.", fields: [
        { id: "fld_title", key: "title", label: "Session title", type: "text", required: true, locked: true, helpText: "Make it specific, clear, and memorable.", placeholder: "e.g. Building evals that your team will actually use", maxChars: 120, options: [] },
        { id: "fld_abstract", key: "abstract", label: "Session abstract", type: "textarea", required: true, locked: false, helpText: "What will you cover, and why does it matter now?", placeholder: "Describe your session…", maxChars: 1200, options: [] },
        { id: "fld_track", key: "track", label: "Best-fit track", type: "dropdown", required: true, locked: false, helpText: "Choose the closest match. Our team may adjust it.", placeholder: "Select a track", maxChars: null, options: ["AI Agents", "Models & Research", "Infrastructure", "Developer Tools", "Product", "Safety", "Applied AI"] },
        { id: "fld_takeaways", key: "takeaways", label: "What will attendees learn?", type: "textarea", required: true, locked: false, helpText: "Share 2–3 concrete takeaways.", placeholder: "Attendees will leave knowing…", maxChars: 600, options: [] },
        { id: "fld_demo", key: "demo", label: "Will you include a live demo?", type: "dropdown", required: true, locked: false, helpText: "", placeholder: "Choose one", maxChars: null, options: ["Yes", "No", "Maybe"] },
        { id: "fld_demo_details", key: "demo_details", label: "Tell us about the demo", type: "textarea", required: false, locked: false, helpText: "What will you show, and what could go wrong?", placeholder: "A few details about your demo…", maxChars: 400, options: [], visibility: { fieldId: "fld_demo", operator: "eq", value: "Yes" } },
      ] },
      { id: "sec_speaker", title: "About you", description: "Help us understand your perspective.", fields: [
        { id: "fld_first", key: "first_name", label: "First name", type: "text", required: true, locked: true, helpText: "", placeholder: "First name", maxChars: 80, options: [] },
        { id: "fld_last", key: "last_name", label: "Last name", type: "text", required: true, locked: true, helpText: "", placeholder: "Last name", maxChars: 80, options: [] },
        { id: "fld_email", key: "email", label: "Email", type: "email", required: true, locked: true, helpText: "We’ll use this for all speaker communication.", placeholder: "you@company.com", maxChars: 254, options: [] },
      ] },
    ],
  }],
  speakers,
  submissions,
  sessions: [
    { id: "ses_1", eventId: DEMO_EVENT_ID, submissionId: "sub_102", title: "The New AI Engineer Stack", speakerIds: ["spk_alex"], track: "Developer Tools", room: "Main Stage", startsAt: "2026-09-15T16:00:00.000Z", endsAt: "2026-09-15T16:45:00.000Z", status: "published", description: "A field guide to the new AI engineering stack." },
    { id: "ses_2", eventId: DEMO_EVENT_ID, submissionId: "sub_101", title: "From Prototype to Production: Evaluating Agentic Systems", speakerIds: ["spk_nadia"], track: "AI Agents", room: "Main Stage", startsAt: "2026-09-15T17:00:00.000Z", endsAt: "2026-09-15T17:30:00.000Z", status: "published", description: "An evaluation framework for agents that operate in the real world." },
    { id: "ses_3", eventId: DEMO_EVENT_ID, submissionId: "sub_103", title: "Serving a Billion Tokens Before Lunch", speakerIds: ["spk_priya"], track: "Infrastructure", room: "Harbor Room", startsAt: "2026-09-15T17:00:00.000Z", endsAt: "2026-09-15T17:30:00.000Z", status: "published", description: "Lessons from scaling model serving." },
    { id: "ses_4", eventId: DEMO_EVENT_ID, submissionId: "sub_105", title: "Small Models, Serious Capability", speakerIds: ["spk_elena"], track: "Models & Research", room: "Main Stage", startsAt: "2026-09-15T18:00:00.000Z", endsAt: "2026-09-15T18:30:00.000Z", status: "published", description: "Where compact open models win." },
    { id: "ses_5", eventId: DEMO_EVENT_ID, submissionId: "sub_106", title: "Red Teaming Agents in the Wild", speakerIds: ["spk_jamal"], track: "Safety", room: "Workshop Studio", startsAt: "2026-09-15T18:00:00.000Z", endsAt: "2026-09-15T19:00:00.000Z", status: "published", description: "A hands-on security workshop." },
    { id: "ses_6", eventId: DEMO_EVENT_ID, submissionId: "sub_107", title: "Designing AI Products People Trust", speakerIds: ["spk_sophia"], track: "Product", room: "Harbor Room", startsAt: "2026-09-15T19:00:00.000Z", endsAt: "2026-09-15T19:30:00.000Z", status: "published", description: "Trustworthy UX patterns for AI products." },
    { id: "ses_7", eventId: DEMO_EVENT_ID, submissionId: "sub_108", title: "The 50ms Inference Stack", speakerIds: ["spk_luis"], track: "Infrastructure", room: "Main Stage", startsAt: "2026-09-16T16:30:00.000Z", endsAt: "2026-09-16T17:00:00.000Z", status: "published", description: "Make every millisecond count." },
    { id: "ses_8", eventId: DEMO_EVENT_ID, submissionId: "sub_110", title: "The Shape of Human–AI Collaboration", speakerIds: ["spk_theo"], track: "Design", room: "Harbor Room", startsAt: "2026-09-16T17:30:00.000Z", endsAt: "2026-09-16T18:00:00.000Z", status: "published", description: "Prototypes for new creative relationships." },
    { id: "ses_unscheduled", eventId: DEMO_EVENT_ID, submissionId: "sub_104", title: "Interfaces for Autonomous Software", speakerIds: ["spk_marcus"], track: "Developer Tools", room: "", startsAt: null, endsAt: null, status: "draft", description: "Interfaces for a world of autonomous software." },
  ],
  tasks: [
    { id: "task_bio", eventId: DEMO_EVENT_ID, title: "Complete your speaker profile", description: "Add a bio, headshot, title, and social links for the public gallery.", mode: "form", target: "contact", dueAt: "2026-08-20T06:59:00.000Z", assigned: 10, completed: 7, required: true },
    { id: "task_slides", eventId: DEMO_EVENT_ID, title: "Upload final slides", description: "PDF or Keynote, up to 100 MB.", mode: "file_request", target: "submission", dueAt: "2026-09-10T06:59:00.000Z", assigned: 8, completed: 3, required: true },
    { id: "task_av", eventId: DEMO_EVENT_ID, title: "Share A/V requirements", description: "Tell our production team about demos, audio, or adapters.", mode: "form", target: "submission", dueAt: "2026-09-01T06:59:00.000Z", assigned: 8, completed: 5, required: true },
    { id: "task_conduct", eventId: DEMO_EVENT_ID, title: "Accept the speaker agreement", description: "Review and accept our code of conduct and recording terms.", mode: "manual", target: "contact", dueAt: "2026-08-18T06:59:00.000Z", assigned: 10, completed: 9, required: true },
  ],
  completions: [
    { taskId: "task_bio", speakerId: "spk_nadia", completedAt: "2026-07-21T15:00:00.000Z" },
    { taskId: "task_conduct", speakerId: "spk_nadia", completedAt: "2026-07-21T15:03:00.000Z" },
    { taskId: "task_av", speakerId: "spk_nadia", completedAt: "2026-07-25T12:00:00.000Z" },
  ],
  communications: [
    { id: "com_1", eventId: DEMO_EVENT_ID, recipient: "nadia@vectorlab.ai", subject: "You’re speaking at AI Engineer World’s Fair!", template: "Decision — accepted", status: "sent", sentAt: "2026-08-07T18:32:00.000Z", preview: "Great news, Nadia—your session has been accepted…" },
    { id: "com_2", eventId: DEMO_EVENT_ID, recipient: "alex@latent.space", subject: "Your AI Engineer speaker checklist", template: "Task assigned", status: "sent", sentAt: "2026-08-07T18:32:00.000Z", preview: "There are a few things we need before the event…" },
    { id: "com_3", eventId: DEMO_EVENT_ID, recipient: "mina@redwood.ai", subject: "We received your proposal", template: "Submission received", status: "sent", sentAt: "2026-08-06T10:14:00.000Z", preview: "Thanks for submitting Memory Is the New Context Window…" },
    { id: "com_4", eventId: DEMO_EVENT_ID, recipient: "marcus@northstar.dev", subject: "Reminder: complete your speaker profile", template: "Task reminder", status: "queued", sentAt: "2026-08-08T16:00:00.000Z", preview: "Your speaker profile is due soon…" },
  ],
  reviews,
  resources: [
    { id: "res_1", eventId: DEMO_EVENT_ID, title: "Speaker handbook", slug: "speaker-handbook", summary: "Everything you need to know before arriving in San Francisco.", body: "<h2>Welcome to AI Engineer</h2><p>We’re thrilled to have you join us. This handbook covers arrival, check-in, stage logistics, and what to expect from our production team.</p><h3>On arrival</h3><p>Please check in at the Speaker Lounge at least 45 minutes before your session.</p>", published: true },
    { id: "res_2", eventId: DEMO_EVENT_ID, title: "Presentation guidelines", slug: "presentation-guidelines", summary: "Slides, aspect ratio, demos, and accessibility guidance.", body: "<h2>Presentation guidelines</h2><p>Design for a 16:9 screen, use at least 28pt type, and keep live demos focused. Upload a PDF backup with your final deck.</p>", published: true },
    { id: "res_3", eventId: DEMO_EVENT_ID, title: "Venue & travel", slug: "venue-and-travel", summary: "Fort Mason directions, hotel suggestions, and local transportation.", body: "<h2>Fort Mason Center</h2><p>The venue is on the northern waterfront. Rideshare drop-off is available at Gate 2.</p>", published: true },
  ],
};
