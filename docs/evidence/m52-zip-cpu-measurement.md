# M52-ZIP — CPU/memory measurement and the streaming rewrite

Recorded Mon Aug 10, 2026. This is a **local `wrangler dev` (workerd) measurement**, never a
deployment — nothing here touched `sb-web-preview` or any other deployed target, and the harness
below runs entirely against local-mode Miniflare/workerd storage.

## 1. The risk

`M52-content-deliverables-lifecycle.md`'s status line flagged this explicitly at merge time:

> the Workers Free CPU budget for a synchronous ZIP build is still an open, unmeasured
> architectural risk.

`processFileExportJobIn` (`src/features/portal/deliverables/server/export.ts`) built the whole
archive in one call: read every selected file's bytes into an `entries` array, called `buildZip`
(`src/features/portal/deliverables/server/zip.ts`) once over the whole array, and wrote the result
with one `bucket.put()`. This document measures that shape against real workerd before deciding
whether it needed to change.

## 2. Method

The measurement harness imports the **actual, unmodified** `buildZip`/`crc32`/`uniqueZipNames`
functions from this repo (a relative import, not a copy) into a minimal standalone Worker, run
under local `wrangler dev` with a real (local-mode) R2 binding:

- Harness: `~/Code/tmp/m52-zip-measure/{worker.ts,wrangler.jsonc}` (scratch, not part of this repo)
- Command: `wrangler dev --config wrangler.jsonc --port 8799 --local-protocol http` — **local
  workerd, `--remote` never used, nothing deployed**
- `GET /seed?count=N&sizeMb=M` writes `N` deterministic-pseudo-random `M`-MiB objects to the local
  `FILES` R2 bucket (ZIP's STORE mode never compresses, so file content doesn't affect the
  measurement — only byte count does; pseudo-random content just avoids a real runtime special-casing
  an all-zero buffer)
- `GET /run?count=N&sizeMb=M` mirrors `processFileExportJobIn`'s original hot path exactly: a
  sequential loop of `bucket.get(key).then(r => r.arrayBuffer())` (identical to `r2.ts`'s
  `getObjectBytes`), then one `buildZip(entries)` call, then one `bucket.put()` of the result —
  timed in three phases with `performance.now()`

`buildZip` is fully synchronous — no `await` inside it — so the wall time of that one call **is**
its CPU time, not a proxy inflated by I/O wait the way total wall time would be. `readMs`/`writeMs`
are R2 I/O and are not part of the CPU-time question (Workers CPU-time limits explicitly exclude
time spent waiting on subrequests/bindings).

Environment: `wrangler 4.120.0`, Node `v26.5.0`, this repo's `zip.ts` as of this change.

## 3. Result: the realistic scenario (25 files × 2 MB = 50 MB)

Three runs, `GET /run?count=25&sizeMb=2`:

| run | readMs | **buildZipMs** | writeMs | totalMs |
|---|---|---|---|---|
| 1 | 100 | **1221** | 1486 | 2807 |
| 2 | 92 | **1226** | 1419 | 2737 |
| 3 | 98 | **1213** | 1455 | 2766 |

**`buildZip` alone costs ~1.2 seconds of CPU time for a 50 MB export.**

### Against the two budgets that actually apply

This project starts on **Workers Free**, whose CPU allowance is **10 ms per invocation**
(`plan/design/platform-integrations.md`, `plan/environments.md` §5). `plan/environments.md` §5
already names the trigger: *"deployed SSR/auth/database probes exceed Free's 10 ms CPU
allowance"* → upgrade to Paid. This measurement is exactly that probe, and it trips the trigger by
**~120x**, not narrowly:

- 1.2 s ÷ 10 ms ≈ **123x over Free's budget**
- Extrapolating the measured rate (~24 µs of CPU per KB) backward, Free's 10 ms budget is
  exhausted by roughly **400 KB of total export content** — a single mid-sized PDF, let alone 25
  files.
- Under **Workers Paid**'s 30 s default CPU budget, 1.2 s is comfortably inside (25x headroom) —
  but `file_export_jobs` batches up to `MAX_TARGETS = 200` targets, and `KIND_POLICY` allows a
  `slide` up to 100 MB; a worse-but-plausible batch (tens of files at tens of MB each) pushes well
  past that headroom, and there is no code-level bound stopping it before this rewrite.

### The other budget: isolate memory (128 MB, both plans)

CPU time is not the only ceiling this shape hits, and unlike CPU time this one **does not go away
on Workers Paid** — the 128 MB per-isolate memory limit applies identically on both plans. The
original code held, simultaneously, for one 50 MB job:

- `entries`: every file's raw bytes — 50 MB
- `buildZip`'s `localParts`: a *second* copy of every entry's bytes, packed with its header —
  another ~50 MB (`concat([localHeader, nameBytes, entry.data])` allocates a fresh buffer per
  entry; the original bytes in `entries` are not released, both arrays are alive at once)
- The final `concat([...localParts, central, end])` — a *third* full-archive-sized allocation

Peak footprint for the measured 50 MB scenario is on the order of **150 MB**, past the 128 MB
ceiling, before accounting for V8/Worker overhead or anything else the request was doing. This is
a reasoned estimate from the code's own allocation pattern, not an isolate-enforced measurement —
local `wrangler dev`/Miniflare does not enforce the production 128 MB cap the way a deployed
Worker does, so this specific failure mode would not have shown up as a crash in this same local
harness, only in production. That gap between "ran fine locally" and "OOMs when deployed" is
itself part of why this was worth measuring rather than assumed.

## 4. Verdict

**Not comfortably inside limits.** Both budgets that matter — Free's CPU allowance (by two orders
of magnitude, and only barely relieved by Paid) and the memory ceiling that applies regardless of
plan — are exceeded by the exact "25 files × 2 MB" scenario named as realistic, and the risk grows
linearly with batch size in an architecture that allows up to 200 files per job with no per-batch
cap. Per the task's own branch condition, this is rewritten rather than merely documented.

## 5. The fix: bounded, resumable batches

`processFileExportJobIn` now advances a job by **one bounded step per call** instead of building
the whole archive at once:

- `src/features/portal/deliverables/server/zip.ts` gains a resumable streaming API
  (`beginZipStream`/`appendZipBatch`/`finishZipStream`) sharing its low-level entry-encoding logic
  with the original `buildZip` (still present, still used for whatever fits in one step) via one
  extracted `buildLocalAndCentral` helper — same bytes out, proven directly in `zip.test.ts` by
  splitting the same entries across batches and asserting byte-identical output to `buildZip`.
- `src/shared/server/r2.ts` gains R2 **multipart upload** primitives
  (`beginExportMultipart`/`uploadExportPart`/`completeExportMultipart`/`abortExportMultipart`).
  Each step reads and ZIPs only enough files to clear R2/S3's ~5 MiB non-final-part floor
  (`EXPORT_PART_TARGET_BYTES = 6 MiB` in `export.ts`, a safety margin above that floor), uploads
  that as one part, and persists resumable progress (next file index, multipart upload id/part
  number, running ZIP offset, small accumulated central-directory bytes, cross-batch filename
  de-duplication state) into a new additive `file_export_jobs.export_state` column
  (`drizzle/0015_export_streaming.sql`).
- Resumption reuses the existing polling contract rather than adding new infrastructure: the
  Files view already polls `GET /api/internal/deliverables/export/[jobId]` every ~1.5 s while a
  job isn't terminal; that route now advances one more step on every call instead of assuming one
  call finishes the job. The cleanup cron (`/api/jobs/cleanup`) also nudges a stalled job
  (`nudgeStalledFileExportsIn`) as a fallback for a closed browser tab.
- The route contract (request/response DTO shape, `POST` then poll `GET`) is unchanged — this is
  an internal rewrite behind the same contract, not a client-visible change.

### Re-measured: per-step cost at the new batch size

Same harness, `GET /run?count=3&sizeMb=2` (6 MB, one `appendZipBatch`-equivalent step) and
`GET /run?count=1&sizeMb=2` (one small file, the common case):

| scenario | buildZipMs (≈ one step's CPU) |
|---|---|
| 3 × 2 MB (6 MB, the ~`EXPORT_PART_TARGET_BYTES` case) | 144 / 159 / 91 |
| 1 × 2 MB (a small single-file export) | 13 |

A ~6 MB step costs **~90–160 ms of CPU**, independent of how many files the whole export contains
— 3 files or 200, the per-invocation cost is now bounded by the batch, not the job. That is still
over Free's 10 ms allowance (nothing that touches ~6 MB of bytes synchronously fits in 10 ms; this
is the same conclusion `plan/environments.md` §5 already reaches for CPU-bound work in general, and
its stated remedy — a Paid upgrade — is what makes the *bounded* per-step cost safe: ~150 ms
against a 30 s default budget is 200x headroom, per step, regardless of total export size). Peak
memory per step is bounded to a small multiple of ~6 MB (≈15–20 MB), comfortably inside the 128 MB
ceiling on either plan, for a job of any size up to `MAX_TARGETS = 200`.

## 6. Tests

- `src/features/portal/deliverables/server/zip.test.ts` — streaming vs. whole-archive byte
  equivalence, an empty stream, and cross-batch filename de-duplication continuity
  (`uniqueZipNamesFrom`).
- `src/features/portal/deliverables/server/export.test.ts` — `planExportBatch`, the pure batch
  boundary decision (stops at the byte target, never stops early except at the true end, advances
  past a vanished row instead of stalling).
- `tests/integration/deliverables.test.ts` (`processFileExportJobIn: multi-step resumption`) — a
  PGlite integration test with an in-memory stand-in for the five R2-touching functions (no fake R2
  binding is available in any harness in this environment) proving a job whose batch exceeds the
  part-size target takes more than one `processFileExportJobIn` call to reach `completed`, resumes
  the same multipart upload id across calls, and produces a correct archive (independently
  re-parsed central directory, three entries) — plus that a small, single-step job still completes
  in one call.

## 7. What this does not claim

- This is not a deployed measurement, and CPU-time numbers from local workerd are a close proxy,
  not a guarantee identical to the production isolate's JIT/scheduling behavior.
- The memory analysis in §3 is reasoned from the code's allocation pattern, not an isolate-enforced
  measurement — see the caveat there.
- A single very large file (the `slide` kind's own 100 MB ceiling) still costs CPU proportional to
  its own size in the one step that hashes it — chunking *within* one file's bytes across multiple
  invocations was out of scope for this fix; at the measured ~24 µs/KB rate a 100 MB file costs
  ~2.4 s of CPU in that one step, which is bounded and known but is a residual, not eliminated.
