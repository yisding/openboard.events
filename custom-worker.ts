// `.open-next/worker.js` is generated before Wrangler bundles this entrypoint.
// @ts-expect-error The generated module is intentionally absent in a clean checkout.
import handler from "./.open-next/worker.js";
// @ts-expect-error `cloudflare:workers` is provided by workerd at runtime.
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  blockPrivateJobRoutes,
  privateJobRequest,
  runPrivateJob,
  type JobRouteHandler,
} from "./workers/job-service";

// Keep this entrypoint structurally typed: Wrangler's generated CloudflareEnv
// references this module for the self-binding, so importing it here would form
// a recursive type graph that makes project type-checking pathologically slow.
type WebWorkerEnv = Record<string, unknown>;
type WebHandler = JobRouteHandler<WebWorkerEnv, unknown>;
const rawWebHandler = handler as WebHandler;
const publicWebHandler = blockPrivateJobRoutes(rawWebHandler);

/** Account-scoped RPC surface used only by the separately deployed jobs Worker. */
export class JobsEntrypoint extends WorkerEntrypoint {
  declare readonly env: WebWorkerEnv;
  declare readonly ctx: unknown;

  async runJob(job: unknown): Promise<Response> {
    return runPrivateJob(job, (name) => rawWebHandler.fetch(
      privateJobRequest(this.env.APP_BASE_URL, name),
      this.env,
      this.ctx,
    ));
  }
}

export default publicWebHandler;

// The re-exports are required by OpenNext's cache implementation.
// @ts-expect-error The generated module is intentionally absent in a clean checkout.
export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
