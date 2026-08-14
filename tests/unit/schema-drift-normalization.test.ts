import { describe, expect, it } from "vitest";
import {
  databaseConstraintDescriptor,
  databaseIndexDescriptor,
  type ConstraintRow,
  type IndexRow,
} from "../../scripts/check-schema-drift";

describe("schema drift normalization", () => {
  it("preserves NULLS NOT DISTINCT from a unique constraint's backing index", () => {
    const row: ConstraintRow = {
      columns: ["submission_id", "field_id", "participant_id"],
      foreign_columns: null,
      foreign_table_name: null,
      kind: "u",
      name: "submission_answers_submission_id_field_id_participant_id_key",
      nulls_not_distinct: true,
      on_delete: "",
      on_update: "",
      table_name: "submission_answers",
    };

    expect(databaseConstraintDescriptor(row)).toBe(
      "submission_answers(submission_id,field_id,participant_id):nullsNotDistinct=true",
    );
  });

  it("includes index order, null placement, uniqueness, and predicate", () => {
    const row: IndexRow = {
      columns: ["event_id", "contact_id", "created_at"],
      flags: [0, 0, 3],
      method: "btree",
      name: "communication_logs_contact_created_idx",
      predicate: "  status = 'queued'::comm_status  ",
      table_name: "communication_logs",
      unique: false,
    };

    expect(databaseIndexDescriptor(row)).toBe(
      "communication_logs_contact_created_idx|table=communication_logs|unique=false"
      + "|method=btree|columns=event_id:asc:last,contact_id:asc:last,created_at:desc:first"
      + "|where=status = 'queued'::comm_status",
    );
    expect(databaseIndexDescriptor({ ...row, flags: [0, 0, 0] }))
      .not.toBe(databaseIndexDescriptor(row));
  });
});
