import { describe, expect, it } from "vitest";
import { bulkMessageDraftFingerprint } from "./bulk-send-tab";

describe("bulk email draft identity", () => {
  const empty = {
    workflowStatus: [],
    confirmationStatus: [],
    subject: "",
    bodyHtml: "",
  } as const;

  it("changes when organizer-authored audience or message content changes", () => {
    const baseline = bulkMessageDraftFingerprint(empty);
    expect(bulkMessageDraftFingerprint({ ...empty, workflowStatus: ["invited"] })).not.toBe(baseline);
    expect(bulkMessageDraftFingerprint({ ...empty, confirmationStatus: ["confirmed"] })).not.toBe(baseline);
    expect(bulkMessageDraftFingerprint({ ...empty, subject: "Schedule update" })).not.toBe(baseline);
    expect(bulkMessageDraftFingerprint({ ...empty, bodyHtml: "<p>Hello</p>" })).not.toBe(baseline);
    expect(bulkMessageDraftFingerprint({ ...empty, previewSendId: "send-1" })).not.toBe(baseline);
  });

  it("treats filter order as the same audience draft", () => {
    const first = bulkMessageDraftFingerprint({
      ...empty,
      workflowStatus: ["accepted", "invited"],
      confirmationStatus: ["declined", "confirmed"],
    });
    const second = bulkMessageDraftFingerprint({
      ...empty,
      workflowStatus: ["invited", "accepted"],
      confirmationStatus: ["confirmed", "declined"],
    });
    expect(second).toBe(first);
  });
});
