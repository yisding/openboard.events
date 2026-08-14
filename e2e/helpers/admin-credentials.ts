export type SeededAdminRole = "organizer" | "reviewer";

const PASSWORD_ENV: Record<SeededAdminRole, readonly [string, string]> = {
  organizer: ["E2E_ADMIN_PASSWORD", "BOOTSTRAP_ADMIN_PASSWORD"],
  reviewer: ["E2E_REVIEWER_PASSWORD", "BOOTSTRAP_REVIEWER_PASSWORD"],
};

/**
 * Resolve the credential shared by E2E bootstrap and browser sign-in.
 *
 * The E2E-specific name wins when both are present; the bootstrap name keeps
 * local/manual runs ergonomic. Trimming matches scripts/bootstrap-admin.ts, so
 * setup cannot write a subtly different password from the one tests submit.
 */
export function seededAdminPassword(
  role: SeededAdminRole,
  env: Record<string, string | undefined> = process.env,
): string {
  const [primary, fallback] = PASSWORD_ENV[role];
  const value = env[primary]?.trim() || env[fallback]?.trim();
  if (!value) {
    throw new Error(
      `Missing ${role} E2E password. Set ${primary} or ${fallback} to the credential used for the seeded account.`,
    );
  }
  return value;
}

/** Apply the operator bootstrap's stronger provisioning requirement. */
export function seededAdminBootstrapPassword(
  role: SeededAdminRole,
  env: Record<string, string | undefined> = process.env,
): string {
  const value = seededAdminPassword(role, env);
  if (value.length < 12) throw new Error(`${role} E2E password must be at least 12 characters`);
  return value;
}
