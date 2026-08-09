import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/uploads/[fileId]/download-url", () => {
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
});
