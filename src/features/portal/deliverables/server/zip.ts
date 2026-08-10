/**
 * A minimal ZIP writer: STORE method only (no compression), no external
 * dependency. Every entry's bytes are copied through byte-for-byte, and a
 * CRC32 is computed for each — the two things a spec-conforming ZIP central
 * directory needs beyond the bytes themselves. Compression is deliberately
 * left out: the module's guardrail is a correct, collision-safe archive, not
 * a small one, and pulling in a DEFLATE implementation would be a new
 * runtime dependency this module's work order does not ask for.
 *
 * Pure and DB/R2-free by design, so it is testable without either.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    const tableEntry = CRC_TABLE[(crc ^ byte) & 0xff] ?? 0;
    crc = (tableEntry ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; data: Uint8Array };

function dosDateTime(date: Date): { time: number; date: number } {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
  const dosYear = Math.max(0, date.getFullYear() - 1980);
  const dosDate = ((dosYear & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { time, date: dosDate };
}

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}
function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

/**
 * Builds a valid, uncompressed ZIP archive from `entries`, in the order
 * given. Caller guarantees `name` is already collision-safe (see
 * `uniqueZipNames` below) — this function does not deduplicate.
 */
export function buildZip(entries: readonly ZipEntry[], now: Date = new Date()): Uint8Array {
  const { time, date } = dosDateTime(now);
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    const size = u32(entry.data.length);

    const localHeader = concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), size, size, u16(nameBytes.length), u16(0),
    ]);
    localParts.push(localHeader, nameBytes, entry.data);
    const localSize = localHeader.length + nameBytes.length + entry.data.length;

    const centralHeader = concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), size, size, u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset),
    ]);
    centralParts.push(centralHeader, nameBytes);

    offset += localSize;
  }

  const centralStart = offset;
  const central = concat(centralParts);
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(centralStart), u16(0),
  ]);

  return concat([...localParts, central, end]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Collision-safe archive paths: an optional group folder plus the filename,
 * with `(2)`, `(3)`, … appended to the stem on a repeat. `zip-safe` here
 * means forward slashes as the only separator and no leading slash — ZIP
 * readers treat a leading `/` or `..` segment as an absolute/escaping path.
 */
export function uniqueZipNames(items: readonly { group: string | null; filename: string }[]): string[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const safeGroup = item.group ? zipSafeSegment(item.group) : null;
    const dot = item.filename.lastIndexOf(".");
    const stem = dot > 0 ? item.filename.slice(0, dot) : item.filename;
    const extension = dot > 0 ? item.filename.slice(dot) : "";
    const base = `${zipSafeSegment(stem)}${extension}`;
    const key = safeGroup ? `${safeGroup}/${base}` : base;
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    const deduped = count === 0 ? base : `${zipSafeSegment(stem)} (${count + 1})${extension}`;
    return safeGroup ? `${safeGroup}/${deduped}` : deduped;
  });
}

function zipSafeSegment(value: string): string {
  // Path separators become dashes, and any run of two-or-more dots is
  // flattened to one — the ZIP-Slip escape sequence a well-behaved extractor
  // would otherwise interpret as "go up a directory" never survives intact,
  // wherever in the string it appears.
  const cleaned = value.replace(/[\\/]+/g, "-").replace(/\.{2,}/g, ".").replace(/^[.\s]+/, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "file";
}
