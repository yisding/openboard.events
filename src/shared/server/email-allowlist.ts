import type { RuntimeEnv } from "@/shared/lib/env";

/** Apply the optional exact-address/domain safety rail only to real sends. */
export function isEmailAllowed(email: string, env: RuntimeEnv): boolean {
  if (env.EMAIL_MODE !== "send" || !env.EMAIL_ALLOWLIST) return true;
  const normalized = email.toLowerCase();
  return env.EMAIL_ALLOWLIST.split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => entry.startsWith("@") ? normalized.endsWith(entry) : normalized === entry);
}
