import { db, type DbOrTx } from "@/db/client";
import type { EventId, OrganizationId, UserId } from "@/shared/contracts";
import { slugify } from "@/shared/lib/slug";
import { acceptOrganizationInvitationByTokenIn } from "./invitations";
import { createOrganizationIn } from "./mutations";

/**
 * M44 — self-serve signup's landing spot. Called from Better Auth's
 * `databaseHooks.user.create.after` (`features/auth/server/better-auth.ts`)
 * for *every* freshly created account — email+password sign-up and a Google
 * sign-in that is nobody's existing account — so a `users` row is never left
 * stranded with zero organization membership, the exact "orphaned account"
 * class of bug M42's own header comment warned about one layer down.
 *
 * Two outcomes, and exactly one always happens:
 *
 * 1. The signup request carries the raw bearer token from `/join?token=…` —
 *    consume that exact invitation after verifying that it was addressed to
 *    this account's email. Email equality without possession of the token is
 *    intentionally insufficient: otherwise anyone who knows an invited
 *    address could choose a password for it and claim the membership.
 * 2. Otherwise — create a new organization and make the new user its owner,
 *    via the same atomic single-CTE write `createOrganizationIn` always used
 *    (M43: "an ownerless organization is a database impossibility").
 *
 * The slug carries a random suffix rather than being retried on collision:
 * two different people both named "Ada" must not fight over `ada`, and a
 * failure here throws all the way back through the signup request rather
 * than silently leaving the account without an organization — see the
 * caller's doc comment for why that is the right failure mode.
 */
export async function provisionOrganizationForNewUserIn(
  dbOrTx: DbOrTx,
  userId: UserId,
  email: string,
  name: string,
  options: { invitationToken?: string; organizationName?: string } = {},
): Promise<{ organizationId: OrganizationId; viaInvitation: boolean; eventId: EventId | null }> {
  if (options.invitationToken) {
    const accepted = await acceptOrganizationInvitationByTokenIn(dbOrTx, options.invitationToken, { userId, email });
    return { organizationId: accepted.organizationId, viaInvitation: true, eventId: accepted.eventId };
  }
  const organizationName = options.organizationName?.trim()
    || (name.trim() ? `${name.trim()}'s organization` : "My organization");
  const base = slugify(options.organizationName?.trim() || name.trim() || email.split("@")[0] || "workspace") || "workspace";
  const suffix = crypto.randomUUID().slice(0, 8);
  const created = await createOrganizationIn(dbOrTx, userId, {
    name: organizationName,
    slug: `${base}-${suffix}`,
  });
  return { organizationId: created.id, viaInvitation: false, eventId: null };
}
export const provisionOrganizationForNewUser = (
  userId: UserId,
  email: string,
  name: string,
  options?: { invitationToken?: string; organizationName?: string },
) => provisionOrganizationForNewUserIn(db, userId, email, name, options);
