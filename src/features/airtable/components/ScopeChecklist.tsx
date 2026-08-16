"use client";

import { Check, ExternalLink, X } from "lucide-react";
import { AIRTABLE_COPY } from "../copy";
import { AIRTABLE_TOKEN_URL, evaluateScopes } from "../scopes";

/**
 * One ✓/✗ row per permission, each with the sentence that says what breaks
 * without it.
 *
 * The scopes are rendered as *capabilities* ("Create and update records"), never
 * as the raw strings Airtable's API uses. `data.records:write` is not something
 * an organizer chose or can act on; "this is the one that actually puts your
 * sessions in the base" is.
 *
 * `evaluateScopes` is the same function the sync engine calls when a write
 * comes back 403, so the guidance here and the guidance on a `blocked` run
 * three weeks later cannot drift.
 */
export function ScopeChecklist({ scopes }: { scopes: readonly string[] }) {
  const verdict = evaluateScopes(scopes);
  return (
    <div className="airtable-scopes">
      <b className="airtable-scopes__heading">{AIRTABLE_COPY.token.scopesHeading}</b>
      <ul>
        {verdict.checklist.map((entry) => (
          <li key={entry.scope} className={entry.granted ? "is-granted" : entry.required ? "is-missing" : "is-optional"}>
            <span className="airtable-scopes__mark" aria-hidden>
              {entry.granted ? <Check size={14} /> : <X size={14} />}
            </span>
            <div>
              {/*
                * The tick is decorative and the rest of the state lives in a
                * class name, so without this a screen reader heard seven
                * capabilities and no indication of which ones the token
                * actually has — on the one screen whose entire job is telling
                * an organizer what their token is missing.
                */}
              <span className="sr-only">{entry.granted
                ? AIRTABLE_COPY.token.scopeGranted
                : entry.required ? AIRTABLE_COPY.token.scopeMissing : AIRTABLE_COPY.token.scopeMissingOptional}</span>
              <b>{entry.title}</b>
              <small>{entry.why}</small>
            </div>
          </li>
        ))}
      </ul>
      {(verdict.missingRequired.length > 0 || verdict.missingOptional.length > 0) && (
        <p className="airtable-scopes__footer">
          {AIRTABLE_COPY.token.scopesFooter}{" "}
          <a href={AIRTABLE_TOKEN_URL} target="_blank" rel="noopener noreferrer">
            {AIRTABLE_COPY.token.createLink} <ExternalLink size={12} aria-hidden />
          </a>
        </p>
      )}
    </div>
  );
}
