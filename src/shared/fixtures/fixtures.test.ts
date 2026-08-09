import { describe, expect, it } from "vitest";
import { COMMITTED_FIELD_TYPES, formSnapshotSchema } from "@/shared/contracts";
import { GOLDEN_SNAPSHOT } from "./form-snapshot";
import { CONTACT_FIXTURE } from "./contacts";
import { SUBMISSION_FIXTURES } from "./submissions";
import { PUBLISHED_SCHEDULE_FIXTURE, PUBLISHED_SPEAKERS_FIXTURE, SESSION_FIXTURES } from "./sessions";
import { TASK_ASSIGNMENT_FIXTURE, TASK_FIXTURE } from "./tasks";
import { COMM_LOG_DETAIL_FIXTURE, COMM_LOG_FIXTURE } from "./comm-log";
import { OUTSTANDING_TASKS_FIXTURE } from "./outstanding-tasks";

describe("shared fixtures", () => {
  it("round-trips the golden snapshot through its wire schema", () => {
    expect(formSnapshotSchema.parse(JSON.parse(JSON.stringify(GOLDEN_SNAPSHOT)))).toEqual(GOLDEN_SNAPSHOT);
  });

  it("exercises every committed field type", () => {
    const fields = GOLDEN_SNAPSHOT.sections.flatMap((section) => section.fields);
    const present = new Set(fields.map((field) => field.type));
    expect(COMMITTED_FIELD_TYPES.every((type) => present.has(type))).toBe(true);
    expect(fields.find((field) => field.key === "track")?.options).toHaveLength(4);
    expect(fields.find((field) => field.key === "format")?.options).toHaveLength(5);
    expect(fields.find((field) => field.key === "topics")?.options).toHaveLength(5);
    expect(fields.find((field) => field.key === "workshop_duration")?.visibility?.conditions[0]).toMatchObject({
      sourceFieldId: "00000000-0000-4000-8000-000000000110",
      op: "eq",
      value: "workshop",
    });
    expect(fields.find((field) => field.key === "bio")?.mapsTo).toBe("contact.bio_html");
    expect(fields.find((field) => field.key === "company")?.mapsTo).toBe("contact.company");
    expect(fields.find((field) => field.key === "job_title")?.mapsTo).toBe("contact.job_title");
  });

  it("ships parsed DTO fixtures for every dependent lane", () => {
    expect(CONTACT_FIXTURE.email).toBe("speaker@example.com");
    expect(SUBMISSION_FIXTURES).toHaveLength(2);
    expect(SESSION_FIXTURES).toHaveLength(2);
    expect(PUBLISHED_SCHEDULE_FIXTURE.days).toEqual(["2026-09-15"]);
    expect(PUBLISHED_SPEAKERS_FIXTURE.speakers[0]?.contactId).toBe("00000000-0000-4000-8000-000000000401");
    expect(TASK_FIXTURE.completionMode).toBe("file_request");
    expect(TASK_ASSIGNMENT_FIXTURE.overdue).toBe(true);
    expect(COMM_LOG_FIXTURE.status).toBe("sent");
    expect(COMM_LOG_DETAIL_FIXTURE.attempts).toBe(1);
    expect(OUTSTANDING_TASKS_FIXTURE.overdueCount).toBe(1);
  });
});
