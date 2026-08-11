// M26 — Resource/wiki pages. Deliberately its own barrel rather than folded
// into `features/portal/index.ts`: that file is WS-D's (PLAN §4/§6 names this
// feature's ownership as a Monday exception), so every consumer this module
// controls — its own route files — imports straight from here. WS-D can fold
// `export * from "./resources"` into the shared barrel later without this
// module's code changing.

export type { ResourcePageDTO, ResourcePageRow } from "./server/queries";
export { getResourcePage, getResourcePageById, listResourcePages } from "./server/queries";

export type { ResourcePageInput, SaveResourcePageInput, SaveResourcePageRequest } from "./server/mutations";
export {
  createResourcePage,
  createResourcePageRequestSchema,
  deleteResourcePage,
  excerptFromHtml,
  reorderResourcePages,
  reorderResourcePagesInputSchema,
  saveResourcePage,
  saveResourcePageInputSchema,
  saveResourcePageRequestSchema,
} from "./server/mutations";
