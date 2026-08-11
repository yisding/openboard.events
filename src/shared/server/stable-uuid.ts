import { createHash } from "node:crypto";

/**
 * Derive a UUID-shaped identifier for child rows owned by an idempotent
 * create operation. The caller-provided parent id is the operation namespace,
 * so retries generate exactly the same children without sharing identifiers
 * across parents.
 */
export function stableUuid(namespace: string, key: string): string {
  const hex = createHash("sha256").update(`${namespace}\0${key}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}
