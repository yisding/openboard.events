import { scanReminders } from "@/features/comms/server/reminders";
import { definePrivateJobRoute } from "../_lib";

export const dynamic = "force-dynamic";

export const { POST } = definePrivateJobRoute("reminders", () => scanReminders());
