/**
 * Identifies the Worker build that generated an ISR document. The marker lives
 * inside the cached HTML, unlike `/api/health` or an outer Worker header, so a
 * post-deploy probe can distinguish a response rendered by this artifact from
 * a still-valid R2 entry left by the previous one.
 */
export function PublicBuildMarker({ sha }: { sha: string }) {
  return <span hidden data-openboard-build={sha} />;
}
