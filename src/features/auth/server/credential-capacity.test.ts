import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_VERIFICATION_CONCURRENCY,
  withCredentialVerificationBudget,
} from "./credential-capacity";

describe("credential verification capacity", () => {
  it("allows one verification per isolate and immediately sheds overlap", async () => {
    expect(CREDENTIAL_VERIFICATION_CONCURRENCY).toBe(1);

    let finishFirst: ((value: string) => void) | undefined;
    const first = withCredentialVerificationBudget(() => new Promise<string>((resolve) => {
      finishFirst = resolve;
    }));

    await expect(withCredentialVerificationBudget(async () => "second")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });

    finishFirst?.("first");
    await expect(first).resolves.toBe("first");
    await expect(withCredentialVerificationBudget(async () => "after-release")).resolves.toBe("after-release");
  });

  it("releases the budget when verification throws", async () => {
    await expect(withCredentialVerificationBudget(async () => {
      throw new Error("verification failed");
    })).rejects.toThrow("verification failed");

    await expect(withCredentialVerificationBudget(async () => "recovered")).resolves.toBe("recovered");
  });
});
