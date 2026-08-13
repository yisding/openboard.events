import { SIGNUP_EVENT_HEADER, SIGNUP_ORGANIZATION_HEADER, SIGNUP_VERIFICATION_CALLBACK, signupDestination } from "./signup-context";
import type { SignupLegalConsent } from "./legal-consent";

type SignupRequest = {
  email: string;
  password: string;
  name: string;
  organizationName: string;
  invitationToken: string | null;
  legalConsent: SignupLegalConsent | null;
  legalConsentAccepted: boolean;
  /** Already normalized by `safeInternalPath` in the signup page. */
  next: string;
};

type GoogleSignupRequest = {
  organizationName: string;
  invitationToken: string | null;
  legalConsent: SignupLegalConsent | null;
  legalConsentAccepted: boolean;
  /** Already normalized by `safeInternalPath` in the signup page. */
  next: string;
};

export type SignupTransition =
  | { destination: string; refresh: boolean }
  | { error: string };

export type GoogleSignupTransition = { url: string } | { error: string };

/** Start the explicit, workspace-aware Google account-creation handoff. */
export async function beginGoogleSignup(
  input: GoogleSignupRequest,
  request: typeof fetch = fetch,
): Promise<GoogleSignupTransition> {
  let response: Response;
  try {
    response = await request("/api/auth/sign-up/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(input.invitationToken
          ? { invitationToken: input.invitationToken }
          : { organizationName: input.organizationName }),
        next: input.next,
        ...(input.legalConsent ? {
          legalConsentAccepted: input.legalConsentAccepted,
          acceptedTermsVersion: input.legalConsent.termsVersion,
          acknowledgedPrivacyVersion: input.legalConsent.privacyVersion,
        } : {}),
      }),
    });
  } catch {
    return { error: "Google signup is temporarily unavailable" };
  }
  const body = await response.json().catch(() => null) as {
    url?: string;
    error?: { message?: string };
    message?: string;
  } | null;
  if (!response.ok) {
    return { error: body?.error?.message || body?.message || "Could not start Google signup" };
  }
  try {
    const url = new URL(body?.url ?? "");
    if (url.protocol !== "https:") throw new Error("insecure OAuth destination");
    return { url: url.toString() };
  } catch {
    return { error: "Google signup is temporarily unavailable" };
  }
}

/** Account creation commits once, then waits for proof of mailbox control. */
export async function signupAndAwaitVerification(
  input: SignupRequest,
  request: typeof fetch = fetch,
): Promise<SignupTransition> {
  let signedUp: Response;
  try {
    signedUp = await request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        name: input.name,
        // The server replaces this neutral destination in the queued link
        // after provisioning, before it releases the first email for delivery.
        callbackURL: SIGNUP_VERIFICATION_CALLBACK,
        ...(input.legalConsent ? {
          legalConsentAccepted: input.legalConsentAccepted,
          acceptedTermsVersion: input.legalConsent.termsVersion,
          acknowledgedPrivacyVersion: input.legalConsent.privacyVersion,
        } : {}),
        ...(input.invitationToken ? { invitationToken: input.invitationToken } : { organizationName: input.organizationName }),
      }),
    });
  } catch {
    return { error: "Signup is temporarily unavailable" };
  }

  if (!signedUp.ok) {
    const body = await signedUp.json().catch(() => null) as { message?: string } | null;
    return { error: body?.message || "Could not create that account" };
  }

  // A newly created invitee returns the concrete organization header because
  // its token was consumed by provisioning. A duplicate signup has no header:
  // keep its invitation through the check-inbox/resend journey because the
  // existing-account hook validates it without consuming it before activation.
  const invitedOrganizationId = signedUp.headers.get(SIGNUP_ORGANIZATION_HEADER);
  const invitedEventId = signedUp.headers.get(SIGNUP_EVENT_HEADER);
  const requestedDestination = input.invitationToken && invitedOrganizationId
    ? "/organizations"
    : input.next;
  const destination = signupDestination(requestedDestination, invitedOrganizationId, invitedEventId);
  const params = new URLSearchParams({ email: input.email.trim().toLowerCase(), next: destination });
  return { destination: `/signup/check-email?${params.toString()}`, refresh: false };
}
