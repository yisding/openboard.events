import { SIGNUP_ORGANIZATION_HEADER, SIGNUP_VERIFICATION_CALLBACK, signupDestination } from "./signup-context";
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

export type SignupTransition =
  | { destination: string; refresh: boolean }
  | { error: string };

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

  // An invitation token is consumed while the account is created. A generic
  // duplicate-signup response carries no organization header, so never put a
  // spent `/join?token=…` back into the activation journey; `/organizations`
  // resolves a new invitee's sole workspace safely.
  const requestedDestination = input.invitationToken ? "/organizations" : input.next;
  const destination = signupDestination(requestedDestination, signedUp.headers.get(SIGNUP_ORGANIZATION_HEADER));
  const params = new URLSearchParams({ email: input.email.trim().toLowerCase(), next: destination });
  return { destination: `/signup/check-email?${params.toString()}`, refresh: false };
}
