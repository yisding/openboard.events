import { APIError } from "better-auth/api";
import type { RuntimeEnv } from "@/shared/lib/env";
import { signupLegalConsent, type SignupLegalConsent } from "../legal-consent";
import {
  OAUTH_SIGNUP_INTENT_COOKIE,
  openOAuthSignupIntent,
} from "./oauth-signup-intent";

export type SignupProvisioningInput = {
  invitationToken?: string;
  organizationName?: string;
};

export type SignupHookInput = {
  provisioning: SignupProvisioningInput;
  consent: SignupLegalConsent | null;
};

type SignupHookContext = {
  path?: string;
  params?: unknown;
  body?: unknown;
  getCookie?: (key: string) => string | null;
} | null;

export const LEGAL_CONSENT_ERROR = "Agree to the current Terms of Service and acknowledge the Privacy Policy to create an account.";
const OAUTH_INTENT_ERROR = "Your Google signup expired or could not be verified. Start again from the signup page.";

function provisioningFromEmailBody(body: Record<string, unknown>): SignupProvisioningInput {
  const invitationToken = typeof body.invitationToken === "string" ? body.invitationToken.trim() : "";
  const organizationName = typeof body.organizationName === "string" ? body.organizationName.trim() : "";
  return {
    ...(invitationToken.length > 0 && invitationToken.length <= 512 ? { invitationToken } : {}),
    ...(organizationName.length > 0 && organizationName.length <= 160 ? { organizationName } : {}),
  };
}

function isGoogleCallback(context: Exclude<SignupHookContext, null>): boolean {
  if (context.path === "/callback/google") return true;
  if (context.path !== "/callback/:id" || !context.params || typeof context.params !== "object") return false;
  return (context.params as { id?: unknown }).id === "google";
}

function rejectConsent(): never {
  throw new APIError("BAD_REQUEST", { message: LEGAL_CONSENT_ERROR });
}

/**
 * Resolve the only two supported new-account doors into one trusted input.
 * Email fields are checked against current server policy; Google fields come
 * from the encrypted callback-only cookie minted by our same-origin endpoint.
 */
export async function resolveSignupHookInput(
  env: RuntimeEnv,
  context: SignupHookContext,
  now = Date.now(),
): Promise<SignupHookInput> {
  const required = signupLegalConsent(env);

  if (context?.path === "/sign-up/email") {
    const body = context.body && typeof context.body === "object"
      ? context.body as Record<string, unknown>
      : {};
    if (required && (
      body.legalConsentAccepted !== true
      || body.acceptedTermsVersion !== required.termsVersion
      || body.acknowledgedPrivacyVersion !== required.privacyVersion
    )) rejectConsent();
    return { provisioning: provisioningFromEmailBody(body), consent: required };
  }

  if (context && isGoogleCallback(context)) {
    const token = context.getCookie?.(OAUTH_SIGNUP_INTENT_COOKIE) ?? null;
    if (!token) {
      if (required) rejectConsent();
      // Consent is dormant, so preserve Better Auth's existing implicit
      // Google signup door. It will use the provider-profile workspace name.
      return { provisioning: {}, consent: null };
    }
    const secret = env.SESSION_SECRET;
    const intent = secret ? await openOAuthSignupIntent(token, secret, now) : null;
    if (!intent) throw new APIError("BAD_REQUEST", { message: OAUTH_INTENT_ERROR });
    if (required && (
      intent.legalVersions?.termsVersion !== required.termsVersion
      || intent.legalVersions?.privacyVersion !== required.privacyVersion
    )) rejectConsent();
    let provisioning: SignupProvisioningInput;
    if (intent.invitationToken) provisioning = { invitationToken: intent.invitationToken };
    else if (intent.organizationName) provisioning = { organizationName: intent.organizationName };
    else throw new APIError("BAD_REQUEST", { message: OAUTH_INTENT_ERROR });
    return {
      provisioning,
      consent: required,
    };
  }

  // No other Better Auth endpoint may create a user while reviewed consent is
  // active. This closes direct requestSignUp/id-token and adapter bypasses.
  if (required) rejectConsent();
  return { provisioning: {}, consent: null };
}
