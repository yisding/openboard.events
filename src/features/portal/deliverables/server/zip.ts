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
 * One entry's local (header+name+data) bytes and central-directory record,
 * at a given running `offset` into the archive. Shared by both `buildZip`
 * (below, the whole-archive-at-once path) and the resumable streaming API
 * (`beginZipStream`/`appendZipBatch`/`finishZipStream`) so the two can never
 * drift into encoding entries differently. `entry.data` is copied exactly
 * once here (into `local`) — the streaming API's whole reason to exist is
 * that this copy, plus `crc32`'s byte-by-byte scan, are the only
 * CPU/memory-bound work either path does, and the streaming path bounds how
 * much of it happens in any one call.
 */
function buildLocalAndCentral(entry: ZipEntry, offset: number, time: number, date: number): { local: Uint8Array; central: Uint8Array; length: number } {
  const nameBytes = new TextEncoder().encode(entry.name);
  const crc = crc32(entry.data);
  const size = u32(entry.data.length);

  const localHeader = concat([
    u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
    u32(crc), size, size, u16(nameBytes.length), u16(0),
  ]);
  const local = concat([localHeader, nameBytes, entry.data]);

  const centralHeader = concat([
    u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
    u32(crc), size, size, u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
    u32(0), u32(offset),
  ]);
  const central = concat([centralHeader, nameBytes]);

  return { local, central, length: local.length };
}

/**
 * Builds a valid, uncompressed ZIP archive from `entries`, in the order
 * given. Caller guarantees `name` is already collision-safe (see
 * `uniqueZipNames` below) — this function does not deduplicate.
 *
 * Holds every entry's bytes, plus one more copy of them, in memory at once
 * and does all of `crc32`'s work in a single synchronous call — safe for a
 * small, bounded archive (this is still what a single-part export uses, and
 * every existing test here exercises it), but exactly the shape M52-ZIP's
 * measurement (`docs/evidence/m52-zip-cpu-measurement.md`) found unsafe at
 * realistic multi-file export sizes. `processFileExportJobIn`
 * (`deliverables/server/export.ts`) uses the streaming API below instead for
 * anything past the first bounded batch.
 */
export function buildZip(entries: readonly ZipEntry[], now: Date = new Date()): Uint8Array {
  const { time, date } = dosDateTime(now);
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const { local, central, length } = buildLocalAndCentral(entry, offset, time, date);
    localParts.push(local);
    centralParts.push(central);
    offset += length;
  }

  const centralStart = offset;
  const central = concat(centralParts);
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(centralStart), u16(0),
  ]);

  return concat([...localParts, central, end]);
}

/**
 * Resumable ZIP-building state: everything needed to append more entries or
 * close out the archive, without holding any entry's *content* bytes. Only
 * `central` scales with the archive — proportional to entry count and name
 * length (tens of bytes each), never to file size — so this is cheap to
 * serialize into a job row and carry across Worker invocations, which is the
 * entire point: an export too big for one invocation's CPU/memory budget can
 * still be built, one bounded batch (and one R2 multipart upload part) per
 * invocation, by round-tripping this state through `deliverables/server/export.ts`.
 */
export type ZipStreamState = {
  offset: number;
  central: Uint8Array;
  count: number;
  /** One timestamp for every entry in the archive, fixed at stream start so entries appended across different invocations don't each carry a slightly different embedded time. */
  timeMs: number;
};

export function beginZipStream(now: Date = new Date()): ZipStreamState {
  return { offset: 0, central: new Uint8Array(0), count: 0, timeMs: now.getTime() };
}

/**
 * Appends one batch of entries to a resumable stream. Returns only this
 * batch's local (header+name+data) bytes — the caller writes them out (as
 * one R2 multipart part) rather than accumulating every batch's bytes
 * together — plus the updated state to persist and pass into the next call.
 * CPU and memory cost are bounded by `entries` alone, never by how much of
 * the archive came before or remains after.
 */
export function appendZipBatch(state: ZipStreamState, entries: readonly ZipEntry[]): { bytes: Uint8Array; state: ZipStreamState } {
  const { time, date } = dosDateTime(new Date(state.timeMs));
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [state.central];
  let offset = state.offset;

  for (const entry of entries) {
    const { local, central, length } = buildLocalAndCentral(entry, offset, time, date);
    localParts.push(local);
    centralParts.push(central);
    offset += length;
  }

  return {
    bytes: concat(localParts),
    state: { offset, central: concat(centralParts), count: state.count + entries.length, timeMs: state.timeMs },
  };
}

/**
 * The archive's tail: central directory plus end-of-central-directory
 * record. Cheap regardless of archive size (proportional to entry count),
 * so the caller appends this directly onto its *last* batch's bytes to form
 * the multipart upload's final part, rather than writing it separately.
 */
export function finishZipStream(state: ZipStreamState): Uint8Array {
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(state.count), u16(state.count),
    u32(state.central.length), u32(state.offset), u16(0),
  ]);
  return concat([state.central, end]);
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
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
  return uniqueZipNamesFrom({}, items).names;
}

/** Per-key repeat counts `uniqueZipNamesFrom` carries from one call to the next — small (one entry per distinct group/filename-stem pair), safe to persist between invocations the same way `ZipStreamState` is. */
export type ZipNameDedupeState = Record<string, number>;

/**
 * Same de-duplication as `uniqueZipNames`, but continuing from a
 * previously-returned `seen` state instead of starting fresh. A resumable
 * export names each processing step's batch independently of every other
 * batch, but two files across *different* batches can still share a
 * group/filename — names must stay unique across the whole archive, not
 * just within one batch, so `processFileExportJobIn` threads `seen` through
 * every step via the job's persisted `export_state`.
 */
export function uniqueZipNamesFrom(
  seen: ZipNameDedupeState,
  items: readonly { group: string | null; filename: string }[],
): { names: string[]; seen: ZipNameDedupeState } {
  const next: ZipNameDedupeState = { ...seen };
  const names = items.map((item) => {
    const safeGroup = item.group ? zipSafeSegment(item.group) : null;
    const dot = item.filename.lastIndexOf(".");
    const stem = dot > 0 ? item.filename.slice(0, dot) : item.filename;
    const extension = dot > 0 ? item.filename.slice(dot) : "";
    const base = `${zipSafeSegment(stem)}${extension}`;
    const key = safeGroup ? `${safeGroup}/${base}` : base;
    const withGroup = (name: string) => (safeGroup ? `${safeGroup}/${name}` : name);
    // Register the name actually emitted, not just the base it came from, and
    // keep counting until the candidate is unused. Registering only the base
    // meant a real filename that already looked like a dedupe suffix collided
    // with one the dedupe produced: `[deck.pdf, deck.pdf, deck (2).pdf]` yielded
    // three entries at two distinct paths. `writeZipEntry` writes both at the
    // identical archive path, an extractor keeps whichever it saw last, and the
    // job still reports `entry_count: 3` — so an organizer's export is silently
    // missing a file they selected, with nothing anywhere saying so.
    let count = next[key] ?? 0;
    let deduped = count === 0 ? base : `${zipSafeSegment(stem)} (${count + 1})${extension}`;
    let dedupedKey = withGroup(deduped);
    while (count > 0 && next[dedupedKey] !== undefined) {
      count += 1;
      deduped = `${zipSafeSegment(stem)} (${count + 1})${extension}`;
      dedupedKey = withGroup(deduped);
    }
    next[key] = count + 1;
    // On a first occurrence the emitted name *is* the base, so the two keys are
    // the same entry and must not be counted twice.
    if (dedupedKey !== key) next[dedupedKey] = (next[dedupedKey] ?? 0) + 1;
    return withGroup(deduped);
  });
  return { names, seen: next };
}

function zipSafeSegment(value: string): string {
  // Path separators become dashes, and any run of two-or-more dots is
  // flattened to one — the ZIP-Slip escape sequence a well-behaved extractor
  // would otherwise interpret as "go up a directory" never survives intact,
  // wherever in the string it appears.
  const cleaned = value.replace(/[\\/]+/g, "-").replace(/\.{2,}/g, ".").replace(/^[.\s]+/, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "file";
}
