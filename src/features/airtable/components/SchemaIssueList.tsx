"use client";

import { AIRTABLE_COPY } from "../copy";
import { manualSchemaInstructions } from "../plan";
import type { SchemaIssue } from "../schemas";

/**
 * What is wrong with the customer's base, named exactly.
 *
 * Amber, not red, and never an operator page: a table someone renamed or a
 * field someone retyped is configuration, not a defect. We never rename,
 * retype, or delete anything in a base we do not own, so the only honest move
 * is to say precisely what we expected and let the organizer decide.
 */
export function SchemaIssueList({ issues }: { issues: readonly SchemaIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="airtable-issues">
      {issues.map((issue) => (
        <li key={`${issue.kind}:${issue.table}:${issue.field ?? ""}`}>
          <b>
            {issue.table}
            {issue.field ? ` · ${issue.field}` : ""}
          </b>
          <small>{issue.instruction}</small>
          {issue.expected && issue.actual && (
            <small className="airtable-issues__types">
              Expected {issue.expected}, found {issue.actual}.
            </small>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The full build-it-by-hand list, generated from `TABLE_PLANS` — the same
 * constant the sync engine writes against, so a copied list can never describe
 * a base we would not actually write to.
 */
export function manualFieldListText(): string {
  return manualSchemaInstructions()
    .map((table) => [
      AIRTABLE_COPY.blocked.tableLine(table.table, table.primaryField),
      ...table.fields.map((field) => `  - ${field.name} (${field.type})`),
    ].join("\n"))
    .join("\n\n");
}

export function ManualFieldList() {
  return (
    <div className="airtable-manual">
      {manualSchemaInstructions().map((table) => (
        <section key={table.table}>
          <b>{AIRTABLE_COPY.blocked.tableLine(table.table, table.primaryField)}</b>
          <ul>
            {table.fields.map((field) => (
              <li key={field.name}>
                <code>{field.name}</code>
                <small>{field.type}</small>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
