import type { ComposeCrmBulkEmailResult } from "@/shared/contracts";

export const CRM_BULK_BATCH_SIZE = 500;

export function mergeCrmBulkEmailResults(results: readonly ComposeCrmBulkEmailResult[]): ComposeCrmBulkEmailResult {
  return results.reduce<ComposeCrmBulkEmailResult>(
    (acc, result) => ({
      queued: acc.queued + result.queued,
      skipped: acc.skipped + result.skipped,
      errors: [...acc.errors, ...result.errors],
      preview: acc.preview ?? result.preview,
    }),
    { queued: 0, skipped: 0, errors: [], preview: null },
  );
}
