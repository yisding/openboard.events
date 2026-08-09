import { createHash } from "node:crypto";

/**
 * Fixed, never change. Every seeded row's id is derived from it, so changing it
 * would orphan every existing seeded row instead of updating it.
 */
export const OPENBOARD_NS = "4f1a5c2e-9b3d-5e7a-8c10-0d2f6b8a1e34";

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error(`${uuid} is not a uuid`);
  const pairs = hex.match(/.{2}/g) ?? [];
  return Uint8Array.from(pairs.map((byte) => Number.parseInt(byte, 16)));
}

/**
 * RFC 4122 v5: SHA-1 over namespace + name, with the version and variant bits
 * set. Implemented here rather than pulled in as a dependency — it is nine lines
 * and the seed is the only caller.
 */
export function uuidv5(name: string, namespace: string): string {
  const digest = createHash("sha1")
    .update(Buffer.from(uuidBytes(namespace)))
    .update(Buffer.from(name, "utf8"))
    .digest();
  const bytes = Uint8Array.prototype.slice.call(digest, 0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The only id source in seed code — no `gen_random_uuid()` anywhere. Determinism
 * is what makes a re-run a no-op and lets the demo script hard-code URLs like
 * `/events/<seedId('event','aie-nyc')>/dashboard`.
 */
export function seedId(kind: string, key: string): string {
  return uuidv5(`seed:${kind}:${key}`, OPENBOARD_NS);
}
