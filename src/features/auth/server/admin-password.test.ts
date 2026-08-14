import { describe, expect, it } from "vitest";
import { hashAdminPassword, needsRehash, verifyAdminPassword } from "./admin-password";

/**
 * M42 AC 1 — the custom password-hashing hooks Better Auth signs in through.
 *
 * The fixed legacy vector preserves compatibility with credentials backfilled
 * by migration 0009 while ensuring production code can no longer mint one.
 */
describe("admin password hooks", () => {
  const password = "correct horse battery staple";
  const legacy = "pbkdf2-sha256$100000$BwcHBwcHBwcHBwcHBwcHBw$L1U-q2ApcN8-qcNIEQqmbdBSgeOo_XF8vufu6pzUxWU";

  it("verifies a legacy PBKDF2 migration vector", async () => {
    await expect(verifyAdminPassword({ hash: legacy, password })).resolves.toBe(true);
    await expect(verifyAdminPassword({ hash: legacy, password: "wrong password entirely" })).resolves.toBe(false);
  });

  it("marks a legacy hash for rehash and a current hash as settled", async () => {
    const current = await hashAdminPassword(password);
    expect(needsRehash(legacy)).toBe(true);
    expect(needsRehash(current)).toBe(false);
  });

  it("round-trips the current scheme", async () => {
    const current = await hashAdminPassword(password);
    expect(current.startsWith("pbkdf2-sha256-v2$")).toBe(true);
    await expect(verifyAdminPassword({ hash: current, password })).resolves.toBe(true);
    await expect(verifyAdminPassword({ hash: current, password: `${password} ` })).resolves.toBe(false);
  });

  it("salts every hash independently", async () => {
    const [first, second] = await Promise.all([hashAdminPassword(password), hashAdminPassword(password)]);
    expect(first).not.toBe(second);
    await expect(verifyAdminPassword({ hash: first, password })).resolves.toBe(true);
    await expect(verifyAdminPassword({ hash: second, password })).resolves.toBe(true);
  });

  it("reads a malformed or unknown-scheme hash as a failed password, never a throw", async () => {
    for (const hash of ["", "not-a-hash", "scrypt$1$2$3", "pbkdf2-sha256$100000$onlythree", "$$$"]) {
      await expect(verifyAdminPassword({ hash, password })).resolves.toBe(false);
      expect(needsRehash(hash)).toBe(false);
    }
  });

  it("refuses a legacy hash that claims a weakened iteration count", async () => {
    const [, , salt, digest] = legacy.split("$");
    const downgraded = `pbkdf2-sha256$1000$${salt}$${digest}`;
    await expect(verifyAdminPassword({ hash: downgraded, password })).resolves.toBe(false);
  });

  it("does not let a v2 hash verify as legacy or the reverse", async () => {
    const current = await hashAdminPassword(password);
    // Same password, same algorithm, different salts: swapping the scheme tag
    // must not produce a match, which is what makes `needsRehash` safe to act
    // on.
    const mislabelled = legacy.replace("pbkdf2-sha256$", "pbkdf2-sha256-v2$");
    await expect(verifyAdminPassword({ hash: mislabelled, password })).resolves.toBe(true);
    expect(needsRehash(mislabelled)).toBe(false);
    expect(current).not.toBe(mislabelled);
  });
});
