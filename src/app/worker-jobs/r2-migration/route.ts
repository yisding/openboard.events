import { definePrivateJobRoute } from "../_lib";

export const dynamic = "force-dynamic";

/** Compatibility adapter for an old jobs Worker during one ordered deploy. */
export const { POST } = definePrivateJobRoute("r2-migration", async () => ({ retired: 1 }));
