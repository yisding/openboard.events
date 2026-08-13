import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { FileCommentDTO, FileVersionDTO } from "@/shared/contracts";
import {
  commentDraftAfterEdit,
  deliverableDetailPaths,
  fetchDeliverableDetail,
  fileCommentDraftStorageKey,
  loadStoredCommentDraft,
  parseStoredCommentDraft,
  persistStoredCommentDraft,
  removeStoredCommentDraft,
  visibleDeliverableDetail,
} from "./files-admin-view";

describe("Files deliverable detail recovery", () => {
  it("never exposes one deliverable's loaded data under another deliverable key", () => {
    const version = { fileUploadId: "upload-a" } as FileVersionDTO;
    const comment = { id: "comment-a" } as FileCommentDTO;
    const visible = visibleDeliverableDetail({
      key: "request-a:contact-a:-",
      status: "ready",
      versions: [version],
      comments: [comment],
      error: "",
    }, "request-b:contact-b:-");

    expect(visible).toEqual({
      key: "request-b:contact-b:-",
      status: "loading",
      versions: [],
      comments: [],
      error: "",
    });
  });

  it("loads both collections only from successful response envelopes", async () => {
    const version = { fileUploadId: "upload-a" } as FileVersionDTO;
    const comment = { id: "comment-a" } as FileCommentDTO;
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [version] }))
      .mockResolvedValueOnce(Response.json({ data: [comment] }));

    await expect(fetchDeliverableDetail({ versions: "/versions", comments: "/comments" }, { fetcher }))
      .resolves.toEqual({ versions: [version], comments: [comment] });
  });

  it("turns an HTTP or malformed-envelope failure into retryable error state", async () => {
    const refused = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: { message: "Versions are temporarily unavailable" } }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ data: [] }));
    await expect(fetchDeliverableDetail({ versions: "/versions", comments: "/comments" }, { fetcher: refused }))
      .rejects.toThrow("Versions are temporarily unavailable");

    const malformed = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: {} }))
      .mockResolvedValueOnce(Response.json({ data: [] }));
    await expect(fetchDeliverableDetail({ versions: "/versions", comments: "/comments" }, { fetcher: malformed }))
      .rejects.toThrow("Could not load file versions");
  });

  it("builds a stable encoded key and omits a null submission", () => {
    expect(deliverableDetailPaths("event 1", {
      fileRequestId: "request/1",
      contactId: "contact+1",
      submissionId: null,
    })).toEqual({
      versions: "/api/internal/deliverables/versions?eventId=event%201&fileRequestId=request%2F1&contactId=contact%2B1",
      comments: "/api/internal/deliverables/comments?eventId=event%201&fileRequestId=request%2F1&contactId=contact%2B1",
    });
  });

  it("stores a bounded, slot-specific stable comment draft for hard-navigation recovery", () => {
    const key = "request-a:contact-a:-";
    const id = "e5000000-0000-4000-8000-000000000090";
    expect(fileCommentDraftStorageKey("event-a", key)).toBe(`openboard:files-comment:event-a:${key}`);
    expect(parseStoredCommentDraft(JSON.stringify({ key, id, body: "Still sending" }), key))
      .toEqual({ key, id, body: "Still sending", attemptedBody: "Still sending" });
    expect(parseStoredCommentDraft(JSON.stringify({ key: "other", id, body: "Wrong slot" }), key)).toBeNull();
    expect(parseStoredCommentDraft("not json", key)).toBeNull();
  });

  it("treats unavailable browser storage as a recoverable send failure", () => {
    const unavailableStorage = () => {
      throw new Error("storage disabled");
    };
    const key = "request-a:contact-a:-";
    const storageKey = fileCommentDraftStorageKey("event-a", key);
    const draft = { key, id: "e5000000-0000-4000-8000-000000000090", body: "Please check this", attemptedBody: "Please check this" };

    expect(loadStoredCommentDraft(storageKey, key, unavailableStorage)).toBeNull();
    expect(persistStoredCommentDraft(storageKey, draft, unavailableStorage)).toBe(false);
    expect(removeStoredCommentDraft(storageKey, unavailableStorage)).toBe(false);
  });

  it("rotates the request id when an organizer edits an attempted comment", () => {
    const key = "request-a:contact-a:-";
    const attempted = {
      key,
      id: "e5000000-0000-4000-8000-000000000090",
      body: "Original message",
      attemptedBody: "Original message",
    };
    const nextId = "e5000000-0000-4000-8000-000000000091";

    expect(commentDraftAfterEdit(attempted, key, "Original message ", () => nextId)).toEqual({
      ...attempted,
      body: "Original message ",
    });
    expect(commentDraftAfterEdit(attempted, key, "Corrected message", () => nextId)).toEqual({
      key,
      id: nextId,
      body: "Corrected message",
      attemptedBody: null,
    });
  });

  it("guards reply drafts and blocks every drawer close path while sending", () => {
    const source = readFileSync(new URL("./files-admin-view.tsx", import.meta.url), "utf8");
    expect(source).toContain("useUnsavedWorkGuard(Boolean(row) && (draftDirty || sending), { blocking: sending })");
    expect(source).toContain("if (sending) return;");
    expect(source).toContain("runGuarded(() => {");
    expect(source).toContain("onClose={requestClose}");
    expect(source).toContain('aria-label="Reply to speaker"');
    expect(source).toContain("persistStoredCommentDraft(fileCommentDraftStorageKey(eventId, key), pendingDraft)");
    expect(source).toContain("recovery storage is unavailable");
    expect(source).toContain("couldn't confirm whether that comment was sent — retry it unchanged");
    expect(source).toContain("setLoadAttempt((attempt) => attempt + 1)");
    expect(source).toContain("comment.id === draft.id && comment.body === draft.attemptedBody");
    expect(source).toContain("commentDraftAfterEdit(draft, key, event.target.value)");
    expect(source).toContain('toast("Comment sent")');
    const receipt = source.indexOf("comment.id === draft.id && comment.body === draft.attemptedBody");
    expect(source.indexOf("removeStoredCommentDraft(fileCommentDraftStorageKey(eventId, key))", receipt)).toBeGreaterThan(receipt);
  });
});
