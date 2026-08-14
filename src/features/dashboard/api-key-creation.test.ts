import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "@/shared/lib/errors";
import {
  API_KEY_LABEL_REQUIRED_MESSAGE,
  API_KEY_LABEL_TOO_LONG_MESSAGE,
  apiKeyCreationLabelError,
  apiKeyCreationOperationSchema,
  isDefinitiveApiKeyCreationError,
  newApiKeyCreationOperation,
} from "./api-key-creation";

describe("API key creation operations", () => {
  it("generates a fresh UUID and 256-bit base64url plaintext for each click", () => {
    const first = newApiKeyCreationOperation("  Judge export  ");
    const second = newApiKeyCreationOperation("Judge export");

    expect(first.label).toBe("Judge export");
    expect(first.operationId).not.toBe(second.operationId);
    expect(first.plaintext).toMatch(/^ob_live_[A-Za-z0-9_-]{43}$/u);
    expect(first.plaintext).not.toBe(second.plaintext);
  });

  it("strictly rejects malformed or caller-truncated frozen secrets", () => {
    expect(apiKeyCreationOperationSchema.safeParse({
      operationId: crypto.randomUUID(),
      label: "Export",
      plaintext: "ob_live_too-short",
    }).success).toBe(false);
  });

  it("validates raw label length before normalizing accepted labels", () => {
    const operation = {
      operationId: crypto.randomUUID(),
      plaintext: `ob_live_${"A".repeat(43)}`,
    };

    expect(apiKeyCreationOperationSchema.safeParse({ ...operation, label: `${"A".repeat(120)} ` }).success).toBe(false);
    expect(apiKeyCreationOperationSchema.safeParse({ ...operation, label: ` ${"A".repeat(120)}` }).success).toBe(false);
    expect(apiKeyCreationLabelError(`${"A".repeat(120)} `)).toBe(API_KEY_LABEL_TOO_LONG_MESSAGE);
    expect(apiKeyCreationLabelError("   ")).toBe(API_KEY_LABEL_REQUIRED_MESSAGE);
    expect(apiKeyCreationOperationSchema.parse({ ...operation, label: "  Judge export  " }).label).toBe("Judge export");
  });

  it("classifies only non-INTERNAL AppErrors as definitive", () => {
    expect(isDefinitiveApiKeyCreationError(new AppError("VALIDATION", "Fix the label"))).toBe(true);
    expect(isDefinitiveApiKeyCreationError(new AppError("INTERNAL", "Unknown outcome"))).toBe(false);
    expect(isDefinitiveApiKeyCreationError(new TypeError("offline"))).toBe(false);
    expect(isDefinitiveApiKeyCreationError(z.object({ id: z.uuid() }).safeParse({ id: "malformed" }).error)).toBe(false);
  });
});
