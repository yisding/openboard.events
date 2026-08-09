import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { SEEDED_HEADSHOT_KEYS, headshotKey } from "./contacts";
import { SEEDED_EVENT_ID } from "./lib/helpers";
import { seedId } from "./lib/ids";

/**
 * Uploads a placeholder headshot for every seeded speaker who has one.
 *
 * `contacts.ts` writes `file_assets` rows; without the objects behind them
 * `/f/{fileId}` serves a 404 and the gallery renders broken images, so the two
 * belong together. Run once per bucket:
 *
 *   pnpm exec tsx scripts/seed/upload-headshots.ts sb-files-preview [--remote]
 *
 * The images are generated rather than checked in — a repository does not need
 * twelve binary blobs to prove a URL resolves.
 */
function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(body.length + 8);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(body, 4);
  new DataView(out.buffer).setUint32(out.length - 4, crc32(body));
  return out;
}

/** A 64×64 solid PNG. Enough to be a real image with real magic bytes. */
function png(rgb: [number, number, number]): Buffer {
  const size = 64;
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header[8] = 8;   // bit depth
  header[9] = 2;   // truecolour
  const raw = new Uint8Array(size * (size * 3 + 1));
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 2 + x * 3] = rgb[1];
      raw[row + 3 + x * 3] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(chunk("IHDR", header)),
    Buffer.from(chunk("IDAT", deflateSync(Buffer.from(raw)))),
    Buffer.from(chunk("IEND", new Uint8Array())),
  ]);
}

const PALETTE: Array<[number, number, number]> = [
  [105, 88, 215], [47, 143, 91], [182, 116, 42], [192, 75, 106], [58, 122, 176], [140, 92, 168],
];

function main(): void {
  const bucket = process.argv[2];
  if (!bucket) throw new Error("usage: tsx scripts/seed/upload-headshots.ts <bucket> [--remote]");
  const remote = process.argv.includes("--remote");
  const dir = mkdtempSync(join(tmpdir(), "openboard-headshots-"));

  let uploaded = 0;
  for (const [index, key] of SEEDED_HEADSHOT_KEYS.entries()) {
    const fileId = seedId("file", `headshot-${key}`);
    const objectKey = headshotKey(SEEDED_EVENT_ID, fileId, key);
    const file = join(dir, `${key}.png`);
    writeFileSync(file, png(PALETTE[index % PALETTE.length] ?? [105, 88, 215]));

    const result = spawnSync("npx", [
      "wrangler", "r2", "object", "put", `${bucket}/${objectKey}`,
      "--file", file, "--content-type", "image/png",
      ...(remote ? ["--remote"] : []),
    ], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`failed to upload ${objectKey}`);
    uploaded += 1;
  }
  console.log(`uploaded ${uploaded} headshots to ${bucket}`);
}

main();
