import { defineJobRoute, stubReminders } from "../_lib";

export const dynamic = "force-dynamic";

// swap: import { scanReminders } from '@/features/comms'
export const { POST } = defineJobRoute("reminders", stubReminders);
