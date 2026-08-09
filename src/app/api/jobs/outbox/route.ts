import { dispatchOutbox } from "@/features/comms";
import { defineJobRoute } from "../_lib";

export const dynamic = "force-dynamic";

export const { POST } = defineJobRoute("outbox", () => dispatchOutbox(50));
