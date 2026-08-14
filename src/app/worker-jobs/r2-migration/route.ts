import { migrateLegacyStagingIn } from "@/shared/server/r2";
import { definePrivateJobRoute } from "../_lib";

export const dynamic = "force-dynamic";

export const { POST } = definePrivateJobRoute("r2-migration", migrateLegacyStagingIn);
