import { redirect } from "next/navigation";
import { getAdminSession } from "@/features/auth";

export default async function EventsLayout({ children }: { children: React.ReactNode }) {
  if (!(await getAdminSession())) redirect("/login?next=/events");
  return children;
}
