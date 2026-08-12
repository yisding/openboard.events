import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/features/auth";
import { eventCreationDestination, listOrganizationsForUser } from "@/features/organizations";

export const metadata: Metadata = { title: "Create event" };
export const dynamic = "force-dynamic";

/** Retained as a compatibility URL; the guided organization wizard is canonical. */
export default async function Page() {
  const identity = await getAdminSession();
  if (!identity) redirect("/login?next=%2Fevents%2Fnew");
  const memberships = await listOrganizationsForUser(identity.userId);
  redirect(eventCreationDestination(memberships));
}
