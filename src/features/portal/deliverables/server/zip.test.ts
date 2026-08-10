import { describe, expect, it } from "vitest";
import { buildZip, crc32, uniqueZipNames, type ZipEntry } from "./zip";

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

  it("strips path separators and leading dots out of a hostile group or filename", () => {
    const names = uniqueZipNames([{ group: "../../etc", filename: "../../passwd.txt" }]);
    expect(names[0]).not.toContain("..");
    expect(names[0]?.startsWith("/")).toBe(false);
  });
});
