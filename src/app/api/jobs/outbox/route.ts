import { defineJobRoute, stubOutbox } from "../_lib";

export const dynamic = "force-dynamic";

// swap: import { dispatchOutbox } from '@/features/comms'
export const { POST } = defineJobRoute("outbox", stubOutbox);
