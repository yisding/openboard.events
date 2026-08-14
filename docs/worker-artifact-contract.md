# Worker artifact compatibility contract

The `.open-next` directory is a supported release product, not an incidental
side effect of `next build`. A dependency or configuration change is releasable
only when that artifact passes the gates below and survives the preview canary.

## Supported matrix

| Component | Supported value |
| --- | --- |
| Node.js | 22.x |
| Next.js / eslint-config-next | 15.5.23 |
| OpenNext Cloudflare | 1.20.2 (transitively OpenNext AWS 4.1.0) |
| Wrangler | 4.120.0 |
| Cloudflare compatibility date | 2026-08-01 |
| Base compatibility flags | `nodejs_compat` |
| Production-only flag | `global_fetch_strictly_public` |

These values are pinned in `.node-version`, `package.json`, the lockfile, and
`wrangler.jsonc`. Update this table in the same PR that changes one of them.

## Custom bundling inventory

`next.config.ts` has one Worker-specific Webpack override. For production
Node-runtime server compilations it lowers `splitChunks.minSize` to zero and
removes the browser-oriented initial/async request caps. It deliberately does
not name a cache group.

`wrangler.jsonc` also enables Wrangler's supported final `minify` pass.
OpenNext's generated handler is valid but only partially minified; on the same
local artifact, Wrangler reduced the upload from 19,353.00 to 14,138.35 KiB
and its gzip size from 2,593.73 to 2,338.69 KiB. This is a deployment compiler
setting, not another Webpack chunk assumption, and all completeness/workerd
gates run against its output.

The override remains necessary with the supported matrix. A clean comparison
on 2026-08-14 measured:

| Configuration | Server chunks | Handler inputs | Compressed Worker |
| --- | ---: | ---: | ---: |
| Next defaults | 75 | 758 | 3,329.11 KiB |
| Current override | 257 | 940 | 2,561.52 KiB |

The default exceeds the Workers Free 3,072 KiB compressed limit. OpenNext
1.20.2 also enumerates only numeric `.next/server/chunks/*.js` filenames when
it rewrites Webpack's runtime for workerd. A named cache group can therefore
produce an apparently smaller bundle that fails every request with an unknown
chunk at runtime.

Do not add another custom bundling optimization without a before/after
reproduction and all artifact gates. Remove the existing override only when a
clean build with Next's defaults is at or below 3,072 KiB (preferably below the
2,560 KiB warning threshold), every on-disk server chunk is bundled, and the
full local workerd matrix passes. Record the comparison in this document.

## Required artifact gates

After `pnpm build:worker`, the release path runs:

1. `pnpm smoke:worker`, which boots the artifact under local workerd and probes
   a dynamic server component, an R2-backed static prerender, page and API auth
   entries, the health API, middleware/host redirects, and the lazy rich-text
   editor client chunk. It records startup latency and cold-start failures.
2. `pnpm bundle:client`, which enforces browser bundle budgets.
3. `pnpm worker:size`, which fails if any emitted server chunk is absent from
   the Worker, fails above 3,072 KiB gzip, and records compressed/uncompressed
   size, handler input count, server chunk count, static asset count, and the
   exact compatibility matrix in the GitHub step summary.

The deploy wrapper rebuilds and runs `worker:size` against the target
environment before it changes the remote web Worker. After deployment,
`scripts/post-deploy-smoke.sh --strict` verifies the deployment marker, public
rendering, auth/health behavior, and an R2 incremental-cache hit on the actual
Cloudflare runtime.

## Upgrade procedure

Use a dedicated dependency PR and change one matrix dimension at a time:

- Next.js and `eslint-config-next` move together.
- OpenNext Cloudflare moves with its resolved OpenNext AWS dependency.
- Wrangler moves independently.
- A compatibility date or flag change moves independently.

For each PR:

1. Update the pin, lockfile, supported-matrix table, and generated Cloudflare
   types if required.
2. Run the full credential-free `pnpm release:check`. Compare the Worker
   metrics with the base branch and investigate missing modules, material size
   growth, or cold-start failures before merging.
3. Merge only after CI passes. The deploy workflow promotes that exact commit
   to preview first, sequentially runs migrations, web/jobs deployment, strict
   post-deploy smoke, and the self-service browser journey.
4. Let preview pass at least one scheduled 15-minute uptime cycle with no new
   Worker errors. Production is then promoted through the protected manual
   workflow, which replays the exact commit through preview and keeps the
   production job behind that successful canary with an explicit
   `needs: preview` dependency.

If preview fails, stop promotion and either fix forward in a new PR or follow
the Worker rollback runbook. Never compensate by weakening the artifact gate
or manually deploying an unmeasured build.
