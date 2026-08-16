import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventId, FileId } from "@/shared/contracts";
import { GET } from "./route";

// The route resolves the acting uploader through `@/features/auth`; a signed-out
// caller is every guard returning null, which is what makes `requireUploader`
// answer UNAUTHORIZED regardless of the event a real file names.
vi.mock("@/features/auth", () => ({
  getAdminSession: vi.fn(async () => null),
  adminAuth: () => async () => null,
  portalAuth: () => async () => null,
}));

const describeFile = vi.fn();
const getDownloadUrl = vi.fn();
vi.mock("@/shared/server/r2", () => ({
  describeFile: (id: string) => describeFile(id),
  getDownloadUrl: (...args: unknown[]) => getDownloadUrl(...args),
}));

const REAL_FILE_ID = "11111111-1111-4111-8111-111111111111";
const UNKNOWN_FILE_ID = "22222222-2222-4222-8222-222222222222";

function request(fileId: string): [NextRequest, { params: Promise<{ fileId: string }> }] {
  return [
    new NextRequest(`http://localhost/api/uploads/${fileId}/download-url`),
    { params: Promise.resolve({ fileId }) },
  ];
}

describe("GET /api/uploads/[fileId]/download-url", () => {
  beforeEach(() => {
    describeFile.mockReset();
    getDownloadUrl.mockReset();
  });

  it("returns a validation error for a malformed file id", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/uploads/not-a-uuid/download-url"),
      { params: Promise.resolve({ fileId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "VALIDATION", message: "Invalid file id" },
    });
  });

  // The id-oracle regression: an unknown id must not be distinguishable from a
  // real file the caller is not allowed to see. Before the fix the first
  // answered 404 and the second 401, which let a signed-out caller enumerate
  // real file ids.
  it("answers an unknown id and a real-but-unauthorized id identically", async () => {
    describeFile.mockImplementation(async (id: string) =>
      id === REAL_FILE_ID
        ? { fileId: id as FileId, eventId: "eeeeeeee-0000-4000-8000-000000000001" as EventId }
        : null,
    );

    const realResponse = await GET(...request(REAL_FILE_ID));
    const unknownResponse = await GET(...request(UNKNOWN_FILE_ID));

    expect(realResponse.status).toBe(401);
    expect(unknownResponse.status).toBe(realResponse.status);
    const realBody = await realResponse.json();
    const unknownBody = await unknownResponse.json();
    expect(unknownBody).toEqual(realBody);
    expect(realBody).toEqual({ error: { code: "UNAUTHORIZED", message: "Sign in required" } });
    // The oracle would have leaked here: a mint attempt for a non-existent file
    // must never reach R2.
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });
});
