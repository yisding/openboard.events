import type { DbOrTx } from "@/db/client";
import { userLegalAcceptances } from "@/db/schema";
import type { UserId } from "@/shared/contracts";
import type { SignupLegalConsent } from "../legal-consent";

/** Store only the stable policy versions, never request fingerprinting data. */
export async function recordSignupLegalAcceptanceIn(
  dbOrTx: DbOrTx,
  userId: UserId,
  consent: SignupLegalConsent,
): Promise<void> {
  await dbOrTx.insert(userLegalAcceptances).values({
    userId,
    termsVersion: consent.termsVersion,
    privacyVersion: consent.privacyVersion,
    source: "signup",
  }).onConflictDoNothing({
    target: [
      userLegalAcceptances.userId,
      userLegalAcceptances.termsVersion,
      userLegalAcceptances.privacyVersion,
    ],
  });
}
