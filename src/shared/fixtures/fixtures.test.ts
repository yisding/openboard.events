import { describe, expect, it } from "vitest";
import { COMMITTED_FIELD_TYPES, formSnapshotSchema } from "@/shared/contracts";
import { GOLDEN_SNAPSHOT } from "./form-snapshot";
import { CONTACT_FIXTURE } from "./contacts";
import { SUBMISSION_FIXTURES } from "./submissions";
import { SESSION_FIXTURES } from "./sessions";
import { TASK_FIXTURE } from "./tasks";
import { COMM_LOG_FIXTURE } from "./comm-log";
import { OUTSTANDING_TASKS_FIXTURE } from "./outstanding-tasks";

describe("shared fixtures", () => {
  it("round-trips the golden snapshot through its wire schema", () => {
    expect(formSnapshotSchema.parse(JSON.parse(JSON.stringify(GOLDEN_SNAPSHOT)))).toEqual(GOLDEN_SNAPSHOT);
  });

  it("exercises every committed field type", () => {
    const present = new Set(GOLDEN_SNAPSHOT.sections.flatMap((section) => section.fields.map((field) => field.type)));
    expect(COMMITTED_FIELD_TYPES.every((type) => present.has(type))).toBe(true);
  });

  it("ships parsed DTO fixtures for every dependent lane", () => {
    expect(CONTACT_FIXTURE.email).toBe("speaker@example.com");
    expect(SUBMISSION_FIXTURES).toHaveLength(2);
    expect(SESSION_FIXTURES).toHaveLength(2);
    expect(TASK_FIXTURE.mode).toBe("file_request");
    expect(COMM_LOG_FIXTURE.status).toBe("sent");
    expect(OUTSTANDING_TASKS_FIXTURE.overdueCount).toBe(1);
  });
});
