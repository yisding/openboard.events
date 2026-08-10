import { cleanupOrphans } from "@/shared/server/r2";
import { defineJobRoute } from "../_lib";

export const dynamic = "force-dynamic";

export const { POST } = defineJobRoute("cleanup", () => cleanupOrphans());
