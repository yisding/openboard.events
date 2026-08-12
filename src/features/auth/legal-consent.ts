import type { RuntimeEnv } from "@/shared/lib/env";

export type SignupLegalConsent = {
  termsUrl: string;
  termsVersion: string;
  privacyUrl: string;
  privacyVersion: string;
};

/**
 * Returns the reviewed policy pair that this deployment asks a new user to
 * accept. `parseEnv` guarantees all-or-none configuration; the defensive
 * count below prevents a partial mock or alternate caller from silently
 * disabling enforcement.
 */
export function signupLegalConsent(
  env: Pick<RuntimeEnv, "LEGAL_TERMS_URL" | "LEGAL_TERMS_VERSION" | "LEGAL_PRIVACY_URL" | "LEGAL_PRIVACY_VERSION">,
): SignupLegalConsent | null {
  const configured = [env.LEGAL_TERMS_URL, env.LEGAL_TERMS_VERSION, env.LEGAL_PRIVACY_URL, env.LEGAL_PRIVACY_VERSION]
    .filter(Boolean).length;
  if (configured === 0) return null;
  if (!env.LEGAL_TERMS_URL || !env.LEGAL_TERMS_VERSION || !env.LEGAL_PRIVACY_URL || !env.LEGAL_PRIVACY_VERSION) {
    throw new Error("Signup legal consent configuration must be complete");
  }
  return {
    termsUrl: env.LEGAL_TERMS_URL,
    termsVersion: env.LEGAL_TERMS_VERSION,
    privacyUrl: env.LEGAL_PRIVACY_URL,
    privacyVersion: env.LEGAL_PRIVACY_VERSION,
  };
}
