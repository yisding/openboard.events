/**
 * What a pasted personal access token can actually do, and what to say when it
 * cannot do enough.
 *
 * Runtime-neutral: the connect dialog renders this before the token is ever
 * stored, and a `blocked` sync run renders the identical sentence when a write
 * later returns 403. One source, so the guidance an organizer reads at 9am
 * matches the guidance they read at 3pm.
 *
 * A caveat worth stating rather than hiding: `whoami`'s `scopes` array is a
 * *claim*. `data.records:write` and `schema.bases:write` cannot be probed
 * without writing, so the first real 403 is the authoritative answer — and it
 * maps back to exactly these strings.
 *
 * For a personal access token there is not even a claim: see
 * `assumeUnreportedScopes`.
 */

export const REQUIRED_SCOPES = ["data.records:read", "data.records:write", "schema.bases:read"] as const;
export const OPTIONAL_SCOPES = ["schema.bases:write", "user.email:read"] as const;
export const ALL_SCOPES = [...REQUIRED_SCOPES, ...OPTIONAL_SCOPES] as const;

export type AirtableScope = (typeof ALL_SCOPES)[number];

export const AIRTABLE_TOKEN_URL = "https://airtable.com/create/tokens";

export type ScopeGuidance = {
  scope: AirtableScope;
  required: boolean;
  /** Bolded lead-in, phrased as the capability rather than the scope string. */
  title: string;
  /** One sentence on what breaks without it. Never generic. */
  why: string;
};

const GUIDANCE: Readonly<Record<AirtableScope, ScopeGuidance>> = {
  "data.records:read": {
    scope: "data.records:read",
    required: true,
    title: "Read records",
    why: "Without it we can’t tell an existing row from a new one, so every sync would re-push everything.",
  },
  "data.records:write": {
    scope: "data.records:write",
    required: true,
    title: "Create and update records",
    why: "This is the one that actually puts your sessions in the base. Nothing syncs without it.",
  },
  "schema.bases:read": {
    scope: "schema.bases:read",
    required: true,
    title: "See tables and fields",
    why: "We need this to find your tables and columns. Add it and we’ll re-check.",
  },
  "schema.bases:write": {
    scope: "schema.bases:write",
    required: false,
    title: "Create tables and fields (optional)",
    why: "With it we build the seven tables for you. Without it you’ll make them by hand — we’ll list every field.",
  },
  "user.email:read": {
    scope: "user.email:read",
    required: false,
    title: "Your account email (optional)",
    why: "Only so this page can show which account is connected.",
  },
};

export function scopeGuidance(scope: AirtableScope): ScopeGuidance {
  return GUIDANCE[scope];
}

export type ScopeVerdict = {
  granted: AirtableScope[];
  missingRequired: AirtableScope[];
  missingOptional: AirtableScope[];
  /** Every required scope present — the token is good enough to connect. */
  canConnect: boolean;
  /** We may create and repair tables ourselves rather than instruct. */
  canManageSchema: boolean;
  /** We may read back the account email for the connected-as line. */
  canReadEmail: boolean;
  /** Ordered checklist for the connect dialog: required first, optional after. */
  checklist: (ScopeGuidance & { granted: boolean })[];
};

export function evaluateScopes(granted: readonly string[]): ScopeVerdict {
  const held = new Set(granted);
  const present = ALL_SCOPES.filter((scope) => held.has(scope));
  const missingRequired = REQUIRED_SCOPES.filter((scope) => !held.has(scope));
  const missingOptional = OPTIONAL_SCOPES.filter((scope) => !held.has(scope));
  return {
    granted: [...present],
    missingRequired: [...missingRequired],
    missingOptional: [...missingOptional],
    canConnect: missingRequired.length === 0,
    canManageSchema: held.has("schema.bases:write"),
    canReadEmail: held.has("user.email:read"),
    checklist: ALL_SCOPES.map((scope) => ({ ...GUIDANCE[scope], granted: held.has(scope) })),
  };
}

/**
 * What to believe a token can do when Airtable declines to say.
 *
 * `GET /v0/meta/whoami` carries a `scopes` array for OAuth access tokens only.
 * A personal access token — the single kind `AIRTABLE_TOKEN_URL` mints and the
 * only kind the connect dialog asks for — answers `{ id, email }` and no
 * `scopes` key at all. Reading that absence as "no scopes granted" refuses
 * every correctly-configured PAT with the three required scopes listed as
 * missing, which is a wrong sentence about the organizer's token as well as a
 * dead end.
 *
 * So an unreported list means *unknown*, and unknown resolves optimistically:
 * assume the token holds what it needs and let Airtable's first 403 be the
 * correction, which is the same rule this module's header already states for
 * the two scopes nobody can probe. That is not a guess with no evidence behind
 * it either — the caller corroborates `schema.bases:read` with a real
 * `listBases` call and removes it on a 403, and `user.email:read` is settled by
 * whether an email came back at all.
 *
 * The cost of being wrong is one `blocked` run whose card names the exact
 * missing scope. The cost of the alternative is a feature nobody can turn on.
 */
export function assumeUnreportedScopes(input: { emailReturned: boolean }): AirtableScope[] {
  return ALL_SCOPES.filter((scope) => scope !== "user.email:read" || input.emailReturned);
}

/**
 * The account line under a connected token. Airtable's `whoami` returns no
 * name, and returns `email` only when `user.email:read` was granted, so the
 * honest fallback is the user id with its middle elided.
 */
export function connectedAccountLabel(airtableUserId: string, accountEmail: string | null): string {
  if (accountEmail) return accountEmail;
  return `usr…${airtableUserId.slice(-4)}`;
}
