import { describe, expect, it } from "vitest";
import { appendZipBatch, beginZipStream, buildZip, crc32, finishZipStream, uniqueZipNames, uniqueZipNamesFrom, type ZipEntry } from "./zip";

/**
 * A from-scratch reader, independent of `buildZip`'s own encoding logic, so
 * this test cannot pass just because the two sides of one implementation
 * agree with each other. Walks the local file headers directly (every
 * `buildZip` output stores uncompressed, so no inflate step is needed) and
 * separately verifies the central directory and end-of-central-directory
 * record point at the right offsets.
 */
function readBackLocalEntries(bytes: Uint8Array): Array<{ name: string; data: Uint8Array; crc: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: Array<{ name: string; data: Uint8Array; crc: number }> = [];
  let offset = 0;
  while (offset < bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen));
    const data = bytes.subarray(dataStart, dataStart + compSize);
    expect(method).toBe(0); // STORE only
    entries.push({ name, data, crc });
    offset = dataStart + compSize;
  }
  return entries;
}

function findEndOfCentralDirectory(bytes: Uint8Array): { entryCount: number; cdSize: number; cdOffset: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return {
        entryCount: view.getUint16(offset + 10, true),
        cdSize: view.getUint32(offset + 12, true),
        cdOffset: view.getUint32(offset + 16, true),
      };
    }
  }
  throw new Error("no end-of-central-directory record found");
}

describe("buildZip", () => {
  it("round-trips every entry's exact bytes, name and CRC", () => {
    const entries: ZipEntry[] = [
      { name: "slides/deck.pdf", data: new TextEncoder().encode("%PDF-1.4 fake pdf bytes") },
      { name: "headshots/ada.jpg", data: crypto.getRandomValues(new Uint8Array(2048)) },
      { name: "empty.txt", data: new Uint8Array(0) },
    ];
    const zip = buildZip(entries, new Date("2026-08-10T12:00:00Z"));

    const readBack = readBackLocalEntries(zip);
    expect(readBack.map((entry) => entry.name)).toEqual(entries.map((entry) => entry.name));
    for (const [index, entry] of readBack.entries()) {
      const original = entries[index];
      if (!original) throw new Error("test setup: missing entry");
      expect(entry.data).toEqual(original.data);
      expect(entry.crc).toBe(crc32(original.data));
    }

    const eocd = findEndOfCentralDirectory(zip);
    expect(eocd.entryCount).toBe(entries.length);
    // The central directory's declared span is exactly the tail of the
    // archive, right up to (and consumed entirely by) the EOCD record.
    expect(eocd.cdOffset + eocd.cdSize).toBe(zip.length - 22);
  });

  it("produces an empty-but-valid archive for zero entries", () => {
    const zip = buildZip([]);
    const eocd = findEndOfCentralDirectory(zip);
    expect(eocd.entryCount).toBe(0);
    expect(zip.length).toBe(22);
  });

  it("is a pure function of its bytes: two entries with identical content still round-trip independently", () => {
    const shared = new TextEncoder().encode("same bytes twice");
    const zip = buildZip([{ name: "a.txt", data: shared }, { name: "b.txt", data: shared }]);
    const readBack = readBackLocalEntries(zip);
    expect(readBack).toHaveLength(2);
    expect(readBack[0]?.data).toEqual(shared);
    expect(readBack[1]?.data).toEqual(shared);
  });
});

describe("crc32", () => {
  it("matches the well-known test vector for \"123456789\"", () => {
    // The standard CRC-32 (zlib/PKZIP polynomial) check value.
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("differs for different input", () => {
    expect(crc32(new TextEncoder().encode("a"))).not.toBe(crc32(new TextEncoder().encode("b")));
  });
});

describe("uniqueZipNames", () => {
  it("groups into a folder and de-duplicates repeats within it", () => {
    const names = uniqueZipNames([
      { group: "Ada Lovelace", filename: "deck.pdf" },
      { group: "Ada Lovelace", filename: "deck.pdf" },
      { group: "Grace Hopper", filename: "deck.pdf" },
    ]);
    expect(names).toEqual([
      "Ada Lovelace/deck.pdf",
      "Ada Lovelace/deck (2).pdf",
      "Grace Hopper/deck.pdf",
    ]);
  });

  it("flattens with no group when none is given, still de-duplicating", () => {
    const names = uniqueZipNames([
      { group: null, filename: "deck.pdf" },
      { group: null, filename: "deck.pdf" },
    ]);
    expect(names).toEqual(["deck.pdf", "deck (2).pdf"]);
  });

  it("keeps a real filename that already looks like a dedupe suffix distinct from a produced one", () => {
    // The dedupe used to register only the *base* name, never the name it
    // emitted, so a genuine `deck (2).pdf` collided with the `deck (2).pdf`
    // the dedupe invented for the second `deck.pdf`. Both entries were then
    // written at the identical archive path: an extractor keeps one, the job
    // still reports three, and a file the organizer selected is silently
    // missing from their export.
    const items = [
      { group: null, filename: "deck.pdf" },
      { group: null, filename: "deck.pdf" },
      { group: null, filename: "deck (2).pdf" },
    ];
    const names = uniqueZipNames(items);
    expect(new Set(names).size).toBe(items.length);

    // Order-independent: the real `deck (2).pdf` may arrive first.
    const reversed = uniqueZipNames([...items].reverse());
    expect(new Set(reversed).size).toBe(items.length);
  });

  it("strips path separators and leading dots out of a hostile group or filename", () => {
    const names = uniqueZipNames([{ group: "../../etc", filename: "../../passwd.txt" }]);
    expect(names[0]).not.toContain("..");
    expect(names[0]?.startsWith("/")).toBe(false);
  });
});

describe("uniqueZipNamesFrom", () => {
  it("continuing from an earlier call's `seen` state still de-duplicates across the split", () => {
    // The same three items as the very first `uniqueZipNames` test above,
    // split across two batches the way a resumable export would see them —
    // must produce the identical names, proving the split is invisible to
    // the archive's own uniqueness guarantee.
    const first = uniqueZipNamesFrom({}, [{ group: "Ada Lovelace", filename: "deck.pdf" }]);
    const second = uniqueZipNamesFrom(first.seen, [
      { group: "Ada Lovelace", filename: "deck.pdf" },
      { group: "Grace Hopper", filename: "deck.pdf" },
    ]);
    expect([...first.names, ...second.names]).toEqual(uniqueZipNames([
      { group: "Ada Lovelace", filename: "deck.pdf" },
      { group: "Ada Lovelace", filename: "deck.pdf" },
      { group: "Grace Hopper", filename: "deck.pdf" },
    ]));
  });

  it("keeps produced and real dedupe-suffixed names distinct across a batch split too", () => {
    // Same collision, but with the colliding pair in different processing
    // steps — the case the persisted `seen` state exists for.
    const first = uniqueZipNamesFrom({}, [
      { group: null, filename: "deck.pdf" },
      { group: null, filename: "deck.pdf" },
    ]);
    const second = uniqueZipNamesFrom(first.seen, [{ group: null, filename: "deck (2).pdf" }]);
    expect(new Set([...first.names, ...second.names]).size).toBe(3);
  });

  it("an empty batch just passes `seen` through unchanged", () => {
    const { names, seen } = uniqueZipNamesFrom({ "deck.pdf": 1 }, []);
    expect(names).toEqual([]);
    expect(seen).toEqual({ "deck.pdf": 1 });
  });
});

describe("streaming ZIP (beginZipStream / appendZipBatch / finishZipStream)", () => {
  it("splitting the same entries across several batches produces byte-identical output to building them all at once", () => {
    const now = new Date("2026-08-10T12:00:00Z");
    const entries: ZipEntry[] = [
      { name: "a.pdf", data: crypto.getRandomValues(new Uint8Array(1000)) },
      { name: "b.pdf", data: crypto.getRandomValues(new Uint8Array(2000)) },
      { name: "c.pdf", data: new Uint8Array(0) },
      { name: "d.pdf", data: crypto.getRandomValues(new Uint8Array(500)) },
    ];
    const wholeArchive = buildZip(entries, now);

    // Batch boundaries deliberately don't line up with anything meaningful
    // (one entry, then two, then one) — a resumable export's batches are
    // sized by bytes read so far, not by entry count, so nothing about
    // `appendZipBatch` should care where a batch happens to end.
    let state = beginZipStream(now);
    const parts: Uint8Array[] = [];
    for (const batch of [[entries[0]], [entries[1], entries[2]], [entries[3]]]) {
      const appended = appendZipBatch(state, batch as ZipEntry[]);
      parts.push(appended.bytes);
      state = appended.state;
    }
    const tail = finishZipStream(state);
    const streamedArchive = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0) + tail.length);
    let at = 0;
    for (const part of [...parts, tail]) { streamedArchive.set(part, at); at += part.length; }

    expect(streamedArchive).toEqual(wholeArchive);
  });

  it("an empty stream (no entries appended) still closes into a valid, empty archive", () => {
    const state = beginZipStream(new Date("2026-08-10T12:00:00Z"));
    const tail = finishZipStream(state);
    expect(tail).toEqual(buildZip([]));
  });
});
