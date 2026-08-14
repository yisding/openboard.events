import { eq } from "drizzle-orm";
import { withTx, type TxDb } from "@/db/client";
import { eventMembers, events, selfServiceSignups, users } from "@/db/schema";
import { hashAdminPassword, upsertAdminCredentialAccount } from "@/features/auth";
import { eventIdSchema, type EventId, type MemberRole, type UserId } from "@/shared/contracts";

const ORGANIZER_EMAIL = "organizer@openboard.dev";
const REVIEWER_EMAIL = "reviewer@openboard.dev";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function password(name: string): string {
  const value = required(name);
  if (value.length < 12) throw new Error(`${name} must be at least 12 characters`);
  return value;
}

async function upsertAdmin(
  tx: TxDb,
  eventId: EventId,
  input: { email: string; name: string; password: string; role: MemberRole },
) {
  const passwordHash = await hashAdminPassword(input.password);
  const [user] = await tx.insert(users)
    // This operator-only recovery path is the authority that establishes the
    // fixed seeded accounts. Mark them verified explicitly so they do not need
    // the self-service mailbox-confirmation journey.
    .values({
      email: input.email,
      name: input.name,
      emailVerified: true,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name: input.name,
        emailVerified: true,
        updatedAt: new Date(),
      },
    })
    .returning({ id: users.id });
  if (!user) throw new Error(`Could not create ${input.email}`);
  // 0029's database trigger treats every unknown new identity as public by
  // default. This operator-only recovery command is the explicit exception.
  await tx.delete(selfServiceSignups).where(eq(selfServiceSignups.userId, user.id));
  await upsertAdminCredentialAccount(tx, user.id as UserId, passwordHash);
  await tx.insert(eventMembers)
    .values({ userId: user.id, eventId, role: input.role })
    .onConflictDoUpdate({
      target: [eventMembers.userId, eventMembers.eventId],
      set: { role: input.role },
    });
}

// tsx transforms this to CJS, where top-level await is unavailable, so the run
// lives in main(). Without it the script dies in esbuild before doing anything.
async function main(): Promise<void> {
  const eventId = eventIdSchema.parse(required("BOOTSTRAP_EVENT_ID"));
  const organizerPassword = password("BOOTSTRAP_ADMIN_PASSWORD");
  const reviewerPassword = password("BOOTSTRAP_REVIEWER_PASSWORD");

  await withTx(async (tx) => {
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
    if (!event) throw new Error(`Event ${eventId} does not exist; migrate and create the event first`);
    await upsertAdmin(tx, eventId, { email: ORGANIZER_EMAIL, name: "Openboard Organizer", password: organizerPassword, role: "owner" });
    await upsertAdmin(tx, eventId, { email: REVIEWER_EMAIL, name: "Openboard Reviewer", password: reviewerPassword, role: "reviewer" });
  });

  console.log(`Admin bootstrap complete for event ${eventId}`);
  console.log(`Owner: ${ORGANIZER_EMAIL}`);
  console.log(`Reviewer: ${REVIEWER_EMAIL}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
