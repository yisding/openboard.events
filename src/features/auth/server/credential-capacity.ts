import { AppError } from "@/shared/lib/errors";

/**
 * Password verification is the only CPU-heavy part of a credential request.
 * Keep a single verification in flight per Worker isolate so a burst cannot
 * make several native PBKDF2 operations compete for the isolate's CPU budget.
 * The distributed database guards in the route remain the first line of
 * defence; this is the final, immediate capacity fuse for traffic spread
 * across keys or Cloudflare locations.
 */
export const CREDENTIAL_VERIFICATION_CONCURRENCY = 1;

let activeCredentialVerifications = 0;

export async function withCredentialVerificationBudget<T>(work: () => Promise<T>): Promise<T> {
  if (activeCredentialVerifications >= CREDENTIAL_VERIFICATION_CONCURRENCY) {
    throw new AppError("RATE_LIMITED", "Too many sign-in attempts. Try again shortly.");
  }

  activeCredentialVerifications += 1;
  try {
    return await work();
  } finally {
    activeCredentialVerifications -= 1;
  }
}
