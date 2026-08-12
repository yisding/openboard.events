import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAdminSession } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";

export default async function EventsLayout({ children }: { children: React.ReactNode }) {
  if (!(await getAdminSession())) {
    const requestPath = safeInternalPath((await headers()).get("x-openboard-request-path"));
    redirect(`/login?next=${encodeURIComponent(requestPath)}`);
  }
  return children;
}
