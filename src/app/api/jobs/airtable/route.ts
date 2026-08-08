import { defineJobRoute, stubAirtable } from "../_lib";

export const dynamic = "force-dynamic";

// swap: import { runAirtableSync } from '@/features/airtable'
export const { POST } = defineJobRoute("airtable", stubAirtable);
