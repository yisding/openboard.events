import { SIGNUP_ORGANIZATION_HEADER, signupDestination } from "./signup-context";

type SignupRequest = {
  email: string;
  password: string;
  name: string;
  organizationName: string;
  invitationToken: string | null;
  /** Already normalized by `safeInternalPath` in the signup page. */
  next: string;
};

export type SignupTransition =
  | { destination: string; refresh: boolean }
  | { error: string };

/**
 * Account creation and immediate sign-in are two separate commits. Once the
 * first succeeds, a failed sign-in must send the new user through the normal
 * login page rather than invite them to submit signup again for an account
 * that now already exists.
 */
export async function signupWithImmediateSignIn(
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

  // Invitation signup consumes its bearer token while creating the account.
  // Preserve the organization destination returned by that successful write;
  // sending a sign-in retry back to `input.next` could revisit a spent token.
  const destination = signupDestination(input.next, signedUp.headers.get(SIGNUP_ORGANIZATION_HEADER));
  const loginDestination = `/login?next=${encodeURIComponent(destination)}`;
  try {
    const signedIn = await request("/api/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: input.email, password: input.password }),
    });
    if (!signedIn.ok) return { destination: loginDestination, refresh: false };
  } catch {
    return { destination: loginDestination, refresh: false };
  }

  return { destination, refresh: true };
}
