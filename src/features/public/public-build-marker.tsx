/**
 * Identifies the exact Worker deployment that generated an ISR document. The
 * marker lives inside the cached HTML, unlike `/api/health` or an outer Worker
 * header, so a post-deploy probe can distinguish a response rendered by this
 * artifact from an R2 entry left by an earlier run of the same commit.
 */
export function PublicBuildMarker({ deploymentId }: { deploymentId: string }) {
  return <span hidden data-openboard-deployment={deploymentId} />;
}
