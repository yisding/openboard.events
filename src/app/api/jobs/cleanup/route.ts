import { defineJobRoute, stubCleanup } from "../_lib";

export const dynamic = "force-dynamic";

// swap: import { cleanupOrphans } from '@/shared/server/r2'
export const { POST } = defineJobRoute("cleanup", stubCleanup);
